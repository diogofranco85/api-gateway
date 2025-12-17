# 🚀 API Gateway

API Gateway moderno e robusto construído com Express.js e TypeScript, oferecendo roteamento dinâmico, segurança avançada, autenticação JWT e resiliência com Circuit Breaker.

## ✨ Características Principais

### 🎯 Core Features

- **Roteamento Dinâmico via YAML**: Configure rotas e serviços sem código
- **Proxy Inteligente**: Roteamento automático para microserviços
- **Suporte a Wildcards**: Rotas dinâmicas com `/*` e parâmetros `:param`
- **Middlewares Customizados**: Sistema flexível de guards e middlewares

### 🔒 Segurança

- **JWT Authentication**: Autenticação flexível com secrets configuráveis
- **CORS**: Controle completo de origens e métodos
- **Helmet**: Proteção contra vulnerabilidades comuns
- **XSS Protection**: Sanitização automática de payloads
- **Rate Limiting**: Proteção contra abuso

### ⚡ Performance & Resiliência

- **Circuit Breaker**: Proteção contra cascatas de falhas
- **Connection Pooling**: HTTP Keep-Alive otimizado
- **Instâncias Axios Cacheadas**: Zero overhead de criação
- **Timeouts Configuráveis**: Controle por serviço
- **Compressão Automática**: Gzip/Deflate para payloads grandes

### 📊 Observabilidade

- **Logging Detalhado**: Request/Response completo com redação de dados sensíveis
- **Performance Metrics**: Latência de cada requisição em dev
- **Circuit Breaker Events**: Logs de transições de estado

### 🛠️ Developer Experience

- **Hot Reload**: Desenvolvimento com `ts-node-dev`
- **TypeScript**: Type safety e IntelliSense
- **YAML Configuration**: Configuração declarativa e legível
- **Validação de Schema**: Integração com Zod para validação

## 📦 Instalação

```bash
# Clone o repositório
git clone <repo-url>
cd api-gateway

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env

# Configure suas rotas
cp src/routes/routes.local.yaml.example src/routes/routes.local.yaml
```

## 🚀 Quick Start

### Desenvolvimento

```bash
# Inicia o servidor em modo desenvolvimento
npm run dev

# Ou com debug habilitado
npm run debug
```

### Produção

```bash
# Build do projeto
npm run build

# Inicia o servidor de produção
npm start
```

## ⚙️ Configuração

### Estrutura de Arquivos

```
api-gateway/
├── src/
│   ├── gateway.ts              # Core do gateway
│   ├── index.ts                # Entry point
│   ├── middlewares/            # Middlewares customizados
│   │   ├── loggerMiddleware.ts
│   │   └── jwtMiddleware.ts
│   ├── guards/                 # Guards de autorização
│   ├── handlers/               # Handlers customizados
│   ├── schemas/                # Schemas de validação (Zod)
│   ├── config/                 # Configurações
│   │   └── sensitive-fields.ts
│   └── routes/                 # Configurações YAML
│       ├── routes.local.yaml
│       ├── routes.homolog.yaml
│       └── routes.prod.yaml
├── docs/                       # Documentação
├── scripts/                    # Scripts utilitários
└── dist/                       # Build de produção
```

### Configuração de Rotas (routes.yaml)

```yaml
gateway:
  cors:
    origins: ["http://localhost:3000"]
    methods: ["GET", "POST", "PUT", "DELETE"]
    credentials: true
  security:
    helmet: true
    sanitizePayload: true
  jwt_secret: "seu-secret-global"

services:
  user-service:
    baseUrl: http://localhost:3001
    timeout: 10000
    jwt_enabled: true
    circuit_breaker:
      enabled: true
      timeout: 10000
      errorThresholdPercentage: 50
      resetTimeout: 30000
      volumeThreshold: 10

routes:
  - path: /api/users/*
    methods: any
    service: user-service
    middlewares: [loggerMiddleware]
```

## 📚 Documentação Completa

### Principais Guias

- **[Circuit Breaker](docs/CIRCUIT_BREAKER.md)**: Implementação e configuração do Circuit Breaker
- **[Performance](docs/PERFORMANCE.md)**: Otimizações e melhores práticas
- **[Rotas - Exemplo Completo](docs/routes.example.yaml)**: Exemplos de configuração
- **[Scripts de Teste](scripts/README.md)**: Scripts utilitários para testes

### Funcionalidades Detalhadas

#### 1. Circuit Breaker

Proteja seus serviços de cascatas de falhas:

```yaml
services:
  external-api:
    baseUrl: http://api.external.com
    circuit_breaker:
      enabled: true
      errorThresholdPercentage: 50  # Abre com 50% de erros
      resetTimeout: 30000           # Tenta fechar após 30s
```

Estados:
- 🟢 **FECHADO**: Operação normal
- 🔴 **ABERTO**: Bloqueia requisições, retorna 503
- 🟡 **MEIO-ABERTO**: Testando recuperação

[Leia mais sobre Circuit Breaker](docs/CIRCUIT_BREAKER.md)

#### 2. JWT Authentication

Autenticação flexível em 3 níveis:

```yaml
gateway:
  jwt_secret: "secret-global"  # Nível 1: Global

services:
  api-service:
    jwt_secret: "secret-service"  # Nível 2: Por serviço
    jwt_enabled: true

routes:
  - path: /admin/*
    jwt_secret: "secret-rota"  # Nível 3: Por rota (maior precedência)
    jwt_enabled: true
```

#### 3. Logging com Redação de Dados Sensíveis

Logs detalhados com proteção automática:

```typescript
// Campos sensíveis são automaticamente mascarados
{
  "password": "***REDACTED***",
  "authorization": "***REDACTED***",
  "otpCode": "***REDACTED***"
}
```

Configure campos adicionais em `src/config/sensitive-fields.ts`.

#### 4. Roteamento Avançado

**Wildcards:**
```yaml
- path: /api/store/*
  service: store-service
```

**Parâmetros:**
```yaml
- path: /users/:id
  service: user-service
```

**Target customizado:**
```yaml
- path: /v1/sessions/create
  service: auth-service
  target: /sessions  # Mapeia para /sessions no upstream
```

**Target com wildcard:**
```yaml
- path: /api/v1/health/*
  service: health-service
  target: /health-check/*  # Propaga tudo após /api/v1/health
```

## 🧪 Testando

### Teste Manual

```bash
# Inicie o gateway
npm run dev

# Em outro terminal, faça requisições
curl http://localhost:3000/api/users
```

### Teste do Circuit Breaker

```bash
# Execute o script de teste
./scripts/test-circuit-breaker.sh

# Com mais requisições
NUM_REQUESTS=50 ./scripts/test-circuit-breaker.sh
```

## 🎯 Tratamento de Erros

O gateway retorna erros padronizados em JSON:

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Not Found"
}
```

### 405 Method Not Allowed
```json
{
  "statusCode": 405,
  "message": "Method Not Allowed",
  "allowedMethods": ["GET", "POST"]
}
```

### 503 Service Unavailable (Circuit Breaker)
```json
{
  "error": "Service Unavailable",
  "message": "Circuit breaker is open for user-service. Service is temporarily unavailable.",
  "statusCode": 503,
  "timestamp": "2024-12-17T10:30:45.123Z"
}
```

### 504 Gateway Timeout
```json
{
  "error": "Gateway Timeout",
  "message": "Request to user-service timed out after 10000ms",
  "statusCode": 504,
  "timestamp": "2024-12-17T10:30:45.123Z"
}
```

## 🔧 Variáveis de Ambiente

```env
# Server
PORT=3000
NODE_ENV=development

# Routes
ROUTES_FILE=./src/routes/routes.local.yaml

# Outras configurações...
```

## 📊 Performance

Com as otimizações implementadas:

- **Latência**: Redução de 50-80% em requisições subsequentes
- **Throughput**: Aumento de 250% em req/segundo
- **CPU**: Redução de 50% no uso
- **Resiliência**: Circuit Breaker previne cascatas de falhas

[Veja detalhes completos de performance](docs/PERFORMANCE.md)

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📝 License

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🙏 Agradecimentos

- [Express.js](https://expressjs.com/)
- [Opossum](https://github.com/nodeshift/opossum) - Circuit Breaker
- [Axios](https://axios-http.com/)
- [Helmet](https://helmetjs.github.io/)
- [Zod](https://zod.dev/)

---

Feito com ❤️ usando TypeScript e Express.js

