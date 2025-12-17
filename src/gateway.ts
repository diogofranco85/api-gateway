import fs from 'fs';
import yaml from 'js-yaml';
import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import express, { Application, Request, Response, RequestHandler, NextFunction } from 'express';
import path from 'path';
import { ZodSchema, ZodError } from 'zod';
import { createJWTMiddleware } from './middlewares/jwtMiddleware';
import CircuitBreaker from 'opossum';

// Cria agentes HTTP/HTTPS otimizados com connection pooling e keepAlive
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo', // Last In First Out - melhor para reutilizar conexões quentes
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo',
  rejectUnauthorized: process.env.NODE_ENV === 'production', // Valida SSL apenas em produção
});

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface SecurityConfig {
  enforceHttps?: boolean;
  helmet?: boolean;
  sanitizePayload?: boolean;
}

interface GatewayConfig {
  cors?: {
    origins: string[];
    methods: string[];
    credentials?: boolean;
  };
  security?: SecurityConfig;
  jwt_secret?: string; // Secret global do gateway
}

interface CircuitBreakerConfig {
  enabled: boolean; // Se o circuit breaker está habilitado
  timeout?: number; // Timeout para requisições (em ms, default: 10000)
  errorThresholdPercentage?: number; // Percentual de erros antes de abrir o circuito (default: 50)
  resetTimeout?: number; // Tempo antes de tentar fechar o circuito novamente (em ms, default: 30000)
  volumeThreshold?: number; // Número mínimo de requisições antes de avaliar o threshold (default: 10)
}

interface ServiceConfig {
  baseUrl?: string; // URL única do serviço (ou use baseUrls para múltiplas)
  baseUrls?: string[]; // Array de URLs para load balancing
  loadBalancer?: 'round-robin' | 'random' | 'least-connections'; // Estratégia de balanceamento (default: round-robin)
  jwt_secret?: string; // Secret específico do serviço
  jwt_enabled?: boolean; // Se JWT está habilitado por padrão para todas as rotas do serviço
  timeout?: number; // Timeout em milissegundos para requisições ao serviço
  circuit_breaker?: CircuitBreakerConfig; // Configuração do circuit breaker
}

export class Gateway {
  private services: Record<string, ServiceConfig> = {};
  private config: GatewayConfig = {};
  private axiosInstances: Record<string, AxiosInstance> = {};
  private circuitBreakers: Record<string, CircuitBreaker> = {};
  // Load balancer state
  private roundRobinCounters: Record<string, number> = {};
  private connectionCounts: Record<string, Record<number, number>> = {};

  constructor(private app: Application) {}

  loadFromYaml(filePath: string) {
    const yamlData = yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
    this.services = yamlData.services || {};
    this.config = yamlData.gateway || {};
    const routes = yamlData.routes;

    // Inicializar circuit breakers para os serviços que tiverem habilitado
    Object.keys(this.services).forEach((serviceName) => {
      const serviceConfig = this.services[serviceName];
      if (serviceConfig && serviceConfig.circuit_breaker?.enabled) {
        this.initializeCircuitBreaker(serviceName, serviceConfig);
      }
    });

    this.applyGlobalSecurity();

    routes.forEach((route: any) => {
      // Suporta tanto 'method' (string) quanto 'methods' (array)
      let methods: string[];
      if (route.methods) {
        if (Array.isArray(route.methods)) {
          methods = route.methods.map((m: string) => m.toLowerCase());
        } else {
          const methodStr = String(route.methods).toLowerCase();
          methods = methodStr === 'any'
            ? ['get', 'post', 'put', 'delete', 'patch']
            : [methodStr];
        }
      } else if (route.method) {
        const methodStr = String(route.method).toLowerCase();
        methods = methodStr === 'any'
          ? ['get', 'post', 'put', 'delete', 'patch']
          : [methodStr];
      } else {
        throw new Error(`Route ${route.path} must have either 'method' or 'methods' defined`);
      }

      const middlewares = this.resolveFunctions(route.middlewares, 'middlewares');
      const guards = this.resolveFunctions(route.guards, 'guards');
      const schemaMiddleware = this.loadSchemaMiddleware(route.schema);

      // Middleware JWT (se configurado)
      const jwtMiddleware = this.buildJWTMiddleware(route);

      const chain: RequestHandler[] = [
        ...middlewares,
        ...guards,
        ...this.buildSecurityChain(route),
      ];

      if (jwtMiddleware) chain.push(jwtMiddleware);
      if (schemaMiddleware) chain.push(schemaMiddleware);

      const handler = route.handler
        ? this.wrapResponse(route.handler, route.response)
        : this.proxyHandler(route.service, route.response, route.target, route.path);

      // Para wildcards, registra apenas uma vez com todos os métodos
      const routePath = route.path;
      if (routePath.includes('/*')) {
        const basePath = routePath.replace(/\/\*$/, '');

        this.app.use(basePath, (req, res, next) => {
          // Verifica se o método está na lista permitida
          const requestMethod = req.method.toLowerCase();
          const allowedMethods = methods.map(m => m.toLowerCase());

          if (allowedMethods.includes(requestMethod)) {
            // Executa a chain e o handler
            const fullChain = [...chain, handler];
            let index = 0;
            const runNext = (err?: any) => {
              if (err) return next(err);
              if (index >= fullChain.length) return;
              const middleware = fullChain[index++];
              if (!middleware) return;
              try {
                middleware(req, res, runNext);
              } catch (error) {
                next(error);
              }
            };
            runNext();
          } else {
            next();
          }
        });
        console.log(`✅ Route registered: [${methods.join(', ').toUpperCase()}] ${routePath} (wildcard)`);
      } else {
        // Rotas normais sem wildcard
        methods.forEach((method) => {
          (this.app as any)[method](routePath, ...chain, handler);
          console.log(`✅ Route registered: [${method.toUpperCase()}] ${routePath}`);
        });
      }
    });
  }

  // ⚡ Inicializa Circuit Breaker para um serviço
  private initializeCircuitBreaker(serviceName: string, serviceConfig: ServiceConfig) {
    const cbConfig = serviceConfig.circuit_breaker!;
    
    const options = {
      timeout: cbConfig.timeout || 10000, // 10 segundos padrão
      errorThresholdPercentage: cbConfig.errorThresholdPercentage || 50, // 50% de erros
      resetTimeout: cbConfig.resetTimeout || 30000, // 30 segundos para tentar fechar
      volumeThreshold: cbConfig.volumeThreshold || 10, // Mínimo de 10 requisições
    };

    // Função que será protegida pelo circuit breaker
    const makeRequest = async (requestConfig: any) => {
      // Se o requestConfig tem baseUrl (passado pelo proxy), usa ela
      const baseUrl = requestConfig.baseUrl;
      const axiosInstance = this.getAxiosInstance(serviceName, baseUrl);
      
      // Remove baseUrl do requestConfig para não interferir com axios
      const { baseUrl: _, ...cleanConfig } = requestConfig;
      
      return await axiosInstance.request(cleanConfig);
    };

    const breaker = new CircuitBreaker(makeRequest, options);

    // Event listeners para logging
    breaker.on('open', () => {
      console.warn(`🔴 Circuit Breaker ABERTO para serviço: ${serviceName}`);
    });

    breaker.on('halfOpen', () => {
      console.log(`🟡 Circuit Breaker MEIO-ABERTO para serviço: ${serviceName} (testando recuperação)`);
    });

    breaker.on('close', () => {
      console.log(`🟢 Circuit Breaker FECHADO para serviço: ${serviceName} (serviço recuperado)`);
    });

    breaker.on('fallback', (result) => {
      console.warn(`⚠️  Circuit Breaker fallback acionado para serviço: ${serviceName}`, result);
    });

    this.circuitBreakers[serviceName] = breaker;
    console.log(`⚡ Circuit Breaker inicializado para serviço: ${serviceName}`, options);
  }

  // ⚖️ Seleciona URL baseada na estratégia de load balancing
  private selectBaseUrl(serviceName: string, serviceConfig: ServiceConfig): string {
    // Se só tem baseUrl, retorna direto
    if (serviceConfig.baseUrl && !serviceConfig.baseUrls) {
      return serviceConfig.baseUrl;
    }

    // Se tem baseUrls, usa load balancing
    const urls = serviceConfig.baseUrls || [];
    if (urls.length === 0) {
      throw new Error(`Service "${serviceName}" must have either baseUrl or baseUrls defined`);
    }

    // Se só tem uma URL, retorna direto
    if (urls.length === 1) {
      return urls[0]!;
    }

    const strategy = serviceConfig.loadBalancer || 'round-robin';

    switch (strategy) {
      case 'round-robin':
        return this.roundRobinSelect(serviceName, urls);
      
      case 'random':
        return this.randomSelect(urls);
      
      case 'least-connections':
        return this.leastConnectionsSelect(serviceName, urls);
      
      default:
        return this.roundRobinSelect(serviceName, urls);
    }
  }

  // 🔄 Round Robin: distribui requisições de forma circular
  private roundRobinSelect(serviceName: string, urls: string[]): string {
    if (!this.roundRobinCounters[serviceName]) {
      this.roundRobinCounters[serviceName] = 0;
    }

    const index = this.roundRobinCounters[serviceName] % urls.length;
    this.roundRobinCounters[serviceName]++;
    
    const selectedUrl = urls[index]!;
    console.log(`🔄 Load Balancer (Round Robin): ${serviceName} → ${selectedUrl} [${index + 1}/${urls.length}]`);
    
    return selectedUrl;
  }

  // 🎲 Random: seleciona URL aleatoriamente
  private randomSelect(urls: string[]): string {
    const index = Math.floor(Math.random() * urls.length);
    const selectedUrl = urls[index]!;
    console.log(`🎲 Load Balancer (Random): ${selectedUrl} [${index + 1}/${urls.length}]`);
    return selectedUrl;
  }

  // 📊 Least Connections: seleciona servidor com menos conexões ativas
  private leastConnectionsSelect(serviceName: string, urls: string[]): string {
    if (!this.connectionCounts[serviceName]) {
      this.connectionCounts[serviceName] = {};
    }
    
    const counts = this.connectionCounts[serviceName];
    urls.forEach((_, index) => {
      if (counts[index] === undefined) {
        counts[index] = 0;
      }
    });

    // Encontra o índice com menos conexões
    let minIndex = 0;
    let minConnections = this.connectionCounts[serviceName][0] || 0;

    for (let i = 1; i < urls.length; i++) {
      const connections = this.connectionCounts[serviceName][i] || 0;
      if (connections < minConnections) {
        minConnections = connections;
        minIndex = i;
      }
    }

    const selectedUrl = urls[minIndex]!;
    console.log(`📊 Load Balancer (Least Connections): ${serviceName} → ${selectedUrl} [${minConnections} conexões ativas]`);
    
    return selectedUrl;
  }

  // 📈 Incrementa contador de conexões
  private incrementConnections(serviceName: string, url: string): void {
    const serviceConfig = this.services[serviceName];
    if (!serviceConfig || !serviceConfig.baseUrls) return;

    const index = serviceConfig.baseUrls.indexOf(url);
    if (index !== -1) {
      if (!this.connectionCounts[serviceName]) {
        this.connectionCounts[serviceName] = {};
      }
      this.connectionCounts[serviceName][index] = (this.connectionCounts[serviceName][index] || 0) + 1;
    }
  }

  // 📉 Decrementa contador de conexões
  private decrementConnections(serviceName: string, url: string): void {
    const serviceConfig = this.services[serviceName];
    if (!serviceConfig || !serviceConfig.baseUrls) return;

    const index = serviceConfig.baseUrls.indexOf(url);
    if (index !== -1) {
      if (!this.connectionCounts[serviceName]) {
        this.connectionCounts[serviceName] = {};
      }
      this.connectionCounts[serviceName][index] = Math.max(0, (this.connectionCounts[serviceName][index] || 0) - 1);
    }
  }

  // 🔒 Aplica segurança global do gateway
  private applyGlobalSecurity() {
    const { cors: corsCfg, security } = this.config;

    if (corsCfg) {
      this.app.use(
        cors({
          origin: corsCfg.origins,
          methods: corsCfg.methods,
          credentials: corsCfg.credentials,
        }),
      );
      console.log('🌐 CORS enabled');
    }

    if (security?.helmet) {
      this.app.use(helmet());
      console.log('🪖  Helmet enabled');
    }

    if (security?.sanitizePayload) {
      // xss-clean não é compatível com Express v5
      // Usando middleware customizado para sanitização básica
      this.app.use((req, res, next) => {
        if (req.body && typeof req.body === 'object') {
          req.body = this.sanitizeObject(req.body);
        }
        next();
      });
      console.log('🧼 Payload sanitization enabled');
    }

    if (security?.enforceHttps) {
      this.app.use((req, res, next) => {
        if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
          return res.status(403).json({ error: 'HTTPS required' });
        }
        next();
      });
      console.log('🔐 HTTPS enforcement active');
    }
  }

  // 🧱 Resolve middlewares dinamicamente
  private resolveFunctions(names: string[], folder: string): RequestHandler[] {
    if (!names) return [];
    return names.map((name) => {
      // Tenta carregar com .ts primeiro (dev), depois .js (prod)
      let fnPath = path.resolve(__dirname, folder, `${name}.ts`);
      let fn: any;

      try {
        fn = require(fnPath);
      } catch (err) {
        // Se não encontrar .ts, tenta .js
        fnPath = path.resolve(__dirname, folder, `${name}.js`);
        try {
          fn = require(fnPath);
        } catch (err2) {
          // Tenta sem extensão
          fnPath = path.resolve(__dirname, folder, name);
          fn = require(fnPath);
        }
      }

      const handler = fn.default || fn[name];
      if (!handler) {
        console.warn(`⚠️  Middleware "${name}" not found in ${fnPath}`);
        return (req: Request, res: Response, next: NextFunction) => next();
      }

      console.log(`✅ Middleware loaded: ${name}`);
      return handler;
    });
  }

  // ✅ Validação com Zod
  private loadSchemaMiddleware(schemaRef?: string): RequestHandler | null {
    if (!schemaRef) return null;
    const parts = schemaRef.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid schema reference: "${schemaRef}". Expected format: "filename.exportName"`);
    }
    const schemaFile = parts[0];
    const schemaName = parts[1];

    if (!schemaFile || !schemaName) {
      throw new Error(`Invalid schema reference parts: ${schemaRef}`);
    }

    const schemaPath = path.resolve(__dirname, 'schemas', `${schemaFile}.ts`);
    const schemaModule = require(schemaPath);
    const schema: ZodSchema = schemaModule[schemaName];

    return (req, res, next) => {
      try {
        schema.parse(req.body);
        next();
      } catch (err: any) {
        if (err instanceof ZodError) {
          return res.status(400).json({ error: 'Validation failed', details: (err as any).errors || (err as any).issues });
        }
        next(err);
      }
    };
  }

  // ⚙️ Constrói cadeia de segurança para rota
  private buildSecurityChain(route: any): RequestHandler[] {
    const chain: RequestHandler[] = [];

    // 🔑 API Key check
    if (route.auth?.apiKey) {
      chain.push((req, res, next) => {
        const key = req.headers['x-api-key'];
        if (!key || key !== process.env.API_KEY) {
          return res.status(401).json({ error: 'Invalid API Key' });
        }
        next();
      });
    }

    // 🧭 Rate limiting
    if (route.auth?.rateLimit) {
      const cfg: RateLimitConfig = route.auth.rateLimit;
      chain.push(rateLimit({ windowMs: cfg.windowMs, max: cfg.max }));
    }

    return chain;
  }

  // 🔐 Configura middleware JWT para a rota
  private buildJWTMiddleware(route: any): RequestHandler | null {
    // Se jwt_disabled está explicitamente true, não aplica JWT
    if (route.jwt_disabled === true) {
      console.log(`⚠️  JWT disabled for route: ${route.path}`);
      return null;
    }

    // Se a rota tem jwt_enabled: true, força JWT
    if (route.jwt_enabled === true) {
      const secret = route.jwt_secret || this.getServiceJWTSecret(route.service) || this.config.jwt_secret;

      if (!secret) {
        throw new Error(`JWT enabled for route ${route.path} but no secret configured`);
      }

      console.log(`🔐 JWT enabled for route: ${route.path}`);
      return createJWTMiddleware(secret);
    }

    // Se o serviço tem jwt_enabled: true e a rota não desabilitou
    const service = route.service ? this.services[route.service] : null;
    if (service?.jwt_enabled && route.jwt_disabled !== true) {
      const secret = service.jwt_secret || this.config.jwt_secret;

      if (!secret) {
        throw new Error(`JWT enabled for service ${route.service} but no secret configured`);
      }

      console.log(`🔐 JWT enabled (service default) for route: ${route.path}`);
      return createJWTMiddleware(secret);
    }

    return null;
  }

  // Obtém o JWT secret de um serviço
  private getServiceJWTSecret(serviceName?: string): string | undefined {
    if (!serviceName) return undefined;
    return this.services[serviceName]?.jwt_secret;
  }

  // Obtém ou cria uma instância axios otimizada para o serviço
  private getAxiosInstance(serviceName: string, baseUrl?: string): AxiosInstance {
    const service = this.services[serviceName];
    if (!service) {
      throw new Error(`Service "${serviceName}" not defined`);
    }

    // Se tem load balancing (múltiplas URLs), não cacheia a instância
    // pois cada requisição pode ir para um servidor diferente
    const hasLoadBalancing = service.baseUrls && service.baseUrls.length > 1;
    
    // Se já existe e não tem load balancing, retorna a instância cacheada
    if (!hasLoadBalancing && this.axiosInstances[serviceName]) {
      return this.axiosInstances[serviceName];
    }

    // Determina a baseURL a ser usada
    const effectiveBaseUrl = baseUrl || this.selectBaseUrl(serviceName, service);

    // Cria instância otimizada para o serviço
    const instance = axios.create({
      baseURL: effectiveBaseUrl,
      timeout: service.timeout || 30000,
      httpAgent,
      httpsAgent,
      maxRedirects: 5,
      validateStatus: (status) => status < 600,
      // Desabilita transformações automáticas para melhor performance
      transformRequest: axios.defaults.transformRequest,
      transformResponse: axios.defaults.transformResponse,
      // Headers padrão otimizados
      headers: {
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    // Interceptor para logging (apenas em dev)
    if (process.env.NODE_ENV === 'development') {
      instance.interceptors.request.use(
        (config) => {
          (config as any).metadata = { startTime: Date.now() };
          return config;
        },
        (error) => Promise.reject(error)
      );

      instance.interceptors.response.use(
        (response) => {
          const duration = Date.now() - (response.config as any).metadata?.startTime;
          console.log(`⚡ ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status} (${duration}ms)`);
          return response;
        },
        (error) => {
          if (error.config?.metadata?.startTime) {
            const duration = Date.now() - error.config.metadata.startTime;
            console.log(`⚡ ${error.config.method?.toUpperCase()} ${error.config.url} - ERROR (${duration}ms)`);
          }
          return Promise.reject(error);
        }
      );
    }

    // Cacheia a instância apenas se não tiver load balancing
    if (!hasLoadBalancing) {
      this.axiosInstances[serviceName] = instance;
    }
    
    return instance;
  }

  // 🔁 Proxy para microserviço
  private proxyHandler(serviceName: string, responseMap?: any, targetPath?: string, routePath?: string): RequestHandler {
    const service = this.services[serviceName];
    if (!service) throw new Error(`Service "${serviceName}" not defined`);

    return async (req, res) => {
      try {
        let upstreamPath: string;

        if (targetPath) {
          // Se target tem wildcard, substitui pela parte dinâmica do path
          if (targetPath.includes('/*') && routePath) {
            // Remove o wildcard do routePath e do targetPath
            const routeBase = routePath.replace(/\/\*$/, '');
            const targetBase = targetPath.replace(/\/\*$/, '');

            // Pega a parte do path após a rota base
            const dynamicPart = req.path.startsWith(routeBase)
              ? req.path.substring(routeBase.length)
              : '';

            // Constrói o path final
            upstreamPath = targetBase + dynamicPart;
          } else {
            // Target com ou sem parâmetros
            // Substitui parâmetros do target pelos valores reais da requisição
            upstreamPath = targetPath;
            
            // Se há parâmetros (:param), substitui pelos valores reais
            if (req.params && Object.keys(req.params).length > 0) {
              Object.keys(req.params).forEach(paramName => {
                const paramValue = req.params[paramName];
                if (paramValue) {
                  upstreamPath = upstreamPath.replace(`:${paramName}`, paramValue);
                }
              });
            }
          }
        } else {
          // Sem target: reconstrói o path substituindo parâmetros
          upstreamPath = req.path;
          
          // Se o path original (route) tem parâmetros, substitui pelos valores reais
          if (routePath && routePath.includes(':')) {
            upstreamPath = routePath;
            
            // Substitui cada parâmetro pelo valor real
            if (req.params && Object.keys(req.params).length > 0) {
              Object.keys(req.params).forEach(paramName => {
                const paramValue = req.params[paramName];
                if (paramValue) {
                  upstreamPath = upstreamPath.replace(`:${paramName}`, paramValue);
                }
              });
            }
          }
        }

        // Seleciona a URL baseada na estratégia de load balancing
        const selectedBaseUrl = this.selectBaseUrl(serviceName, service);
        const url = `${selectedBaseUrl}${upstreamPath}`;
        const method = req.method.toLowerCase();

        console.log(`🔄 Proxying: ${method.toUpperCase()} ${req.originalUrl} → ${url}`);

        // Prepara headers para o proxy
        const headers: any = {};

        // Lista de headers que devem ser copiados
        const headersToCopy = [
          'authorization',
          'content-type',
          'user-agent',
          'accept',
          'accept-language',
          'x-api-key',
          'x-request-id',
          'x-correlation-id',
          'x-forwarded-for',
          'x-real-ip',
        ];

        // Copia headers permitidos
        headersToCopy.forEach(headerName => {
          const value = req.headers[headerName];
          if (value) {
            headers[headerName] = value;
          }
        });

        // Debug: mostra se authorization está presente
        if (req.headers.authorization) {
          console.log(`🔑 Authorization header present: ${req.headers.authorization.substring(0, 20)}...`);
        } else {
          console.log(`⚠️  No authorization header found`);
        }

        // Prepara config da requisição
        const requestConfig = {
          method,
          url: upstreamPath, // Usa path relativo, baseURL já está configurado
          data: req.body,
          params: req.query,
          headers,
          baseUrl: selectedBaseUrl, // Passa a baseUrl selecionada para o circuit breaker
        };

        // Incrementa contador de conexões (para least-connections)
        this.incrementConnections(serviceName, selectedBaseUrl);

        try {
          // Usa circuit breaker se estiver habilitado para este serviço
          let result: any;
          const circuitBreaker = this.circuitBreakers[serviceName];
          
          if (circuitBreaker) {
            console.log(`⚡ Usando Circuit Breaker para: ${serviceName}`);
            result = await circuitBreaker.fire(requestConfig);
          } else {
            // Usa instância axios normal sem circuit breaker
            const axiosInstance = this.getAxiosInstance(serviceName, selectedBaseUrl);
            result = await axiosInstance(requestConfig);
          }
          
          if (result.status >= 200 && result.status < 300) {
            console.log(`✅ Proxy success: ${result.status}`);
          } else {
            console.error(`❌ Proxy error: ${result.status}`);
          }

          //const message = responseMap?.message || 'Success';
          res.status(result.status || 200).json(result.data);
        } finally {
          // Decrementa contador de conexões
          this.decrementConnections(serviceName, selectedBaseUrl);
        }
      } catch (err: any) {
        console.error(`❌ Proxy error:`, {
          message: err.message,
          code: err.code,
          url: err.config?.url,
          method: err.config?.method,
          status: err.response?.status,
          data: err.response?.data,
        });

        // Tratamento específico para circuit breaker aberto
        if (err.message && err.message.includes('Breaker is open')) {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: `Circuit breaker is open for ${serviceName}. Service is temporarily unavailable.`,
            statusCode: 503,
            timestamp: new Date().toISOString(),
          });
        }

        // Se a API retornou um erro, propaga a resposta dela
        if (err.response) {
          return res.status(err.response.status).json(err.response.data);
        }

        // Tratamento específico para timeout
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          return res.status(504).json({
            error: 'Gateway Timeout',
            message: `Request to ${serviceName} timed out after ${service.timeout || 30000}ms`,
            statusCode: 504,
            timestamp: new Date().toISOString(),
          });
        }

        // Se foi erro de rede
        res.status(502).json({
          error: 'Bad Gateway',
          message: err.message || 'Failed to connect to upstream service',
          details: err.code || 'UNKNOWN_ERROR',
          statusCode: 502,
          timestamp: new Date().toISOString(),
        });
      }
    };
  }

  // 🧩 Handler local
  private wrapResponse(handlerString: string, responseMap?: any): RequestHandler {
    const handler = this.resolveHandler(handlerString);
    return async (req, res, next) => {
      try {
        const result = await handler(req, res, next);
        res.status(responseMap?.successCode || 200).json({
          message: responseMap?.message || 'Success',
          data: result,
        });
      } catch (err: any) {
        console.error('❌ Handler error:', err.message);
        res.status(responseMap?.errorCode || 500).json({ error: err.message });
      }
    };
  }

  private resolveHandler(handlerString: string): RequestHandler {
    const parts = handlerString.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid handler reference: "${handlerString}". Expected format: "moduleName.functionName"`);
    }
    const moduleName = parts[0];
    const fnName = parts[1];

    if (!moduleName || !fnName) {
      throw new Error(`Invalid handler reference parts: ${handlerString}`);
    }

    const modulePath = path.resolve(__dirname, 'handlers', `${moduleName}.ts`);
    const module = require(modulePath);
    return module[fnName];
  }

  // Sanitiza objetos removendo scripts maliciosos (substituto do xss-clean)
  private sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      // Remove tags HTML e scripts básicos
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = this.sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  }
}
