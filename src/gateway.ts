import fs from 'fs';
import yaml from 'js-yaml';
import axios from 'axios';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import express, { Application, Request, Response, RequestHandler, NextFunction } from 'express';
import path from 'path';
import { ZodSchema, ZodError } from 'zod';
import { createJWTMiddleware } from './middlewares/jwtMiddleware';

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

interface ServiceConfig {
  baseUrl: string;
  jwt_secret?: string; // Secret específico do serviço
  jwt_enabled?: boolean; // Se JWT está habilitado por padrão para todas as rotas do serviço
  timeout?: number; // Timeout em milissegundos para requisições ao serviço
}

export class Gateway {
  private services: Record<string, ServiceConfig> = {};
  private config: GatewayConfig = {};

  constructor(private app: Application) {}

  loadFromYaml(filePath: string) {
    const yamlData = yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
    this.services = yamlData.services || {};
    this.config = yamlData.gateway || {};
    const routes = yamlData.routes;

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

        const url = `${service.baseUrl}${upstreamPath}`;
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

        // Configura timeout (padrão: 30 segundos)
        const timeout = service.timeout || 30000;

        const result = await axios({
          method,
          url,
          data: req.body,
          params: req.query,
          headers,
          timeout, // Timeout em milissegundos
          maxRedirects: 5,
          validateStatus: (status) => status < 600, // Aceita qualquer status < 600
        });
        if (result.status >= 200 && result.status < 300) {
          console.log(`✅ Proxy success: ${result.status}`);
        } else {
          console.error(`❌ Proxy error: ${result.status}`);
        }

        //const message = responseMap?.message || 'Success';
        res.status(result.status || 200).json(result.data);
      } catch (err: any) {
        console.error(`❌ Proxy error:`, {
          message: err.message,
          code: err.code,
          url: err.config?.url,
          method: err.config?.method,
          status: err.response?.status,
          data: err.response?.data,
        });

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
