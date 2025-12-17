# 🔐 Autenticação JWT no API Gateway

## Visão Geral

O API Gateway possui um sistema completo de autenticação JWT (JSON Web Token) que permite:
- **Secret global** para todo o gateway
- **Secret por serviço** para microsserviços específicos
- **JWT habilitado por padrão** para todos as rotas de um serviço
- **Desabilitar JWT** em rotas específicas
- **Habilitar JWT** em rotas específicas mesmo que o serviço não tenha

## Configuração

### 1. Secret Global (Fallback)

No `routes.yaml`, configure um secret global no nível do gateway:

```yaml
gateway:
  jwt_secret: "seu-secret-global-muito-secreto-aqui"
```

### 2. Secret por Serviço

Cada serviço pode ter seu próprio secret:

```yaml
services:
  auth-service:
    baseUrl: http://localhost:4000
    jwt_secret: "secret-do-auth-service"
```

### 3. JWT Habilitado por Padrão no Serviço

Habilite JWT para TODAS as rotas de um serviço:

```yaml
services:
  store-service:
    baseUrl: http://localhost:3333
    jwt_enabled: true  # <-- Todas as rotas deste serviço exigem JWT
    jwt_secret: "secret-do-store"
```

## Cenários de Uso

### ✅ Cenário 1: Rota Pública (Sem JWT)

```yaml
routes:
  - path: /auth/sign-in
    methods: POST
    service: auth-service
    # Sem jwt_enabled = Não valida JWT
```

### ✅ Cenário 2: Serviço com JWT por Padrão

```yaml
services:
  store-service:
    baseUrl: http://localhost:3333
    jwt_enabled: true  # Todas as rotas exigem JWT

routes:
  - path: /store/orders
    methods: GET
    service: store-service
    # JWT será validado automaticamente
```

### ✅ Cenário 3: Desabilitar JWT em Rota Específica

```yaml
services:
  store-service:
    jwt_enabled: true  # JWT por padrão

routes:
  - path: /store/public/catalog
    methods: GET
    service: store-service
    jwt_disabled: true  # <-- Desabilita JWT apenas nesta rota
```

### ✅ Cenário 4: Habilitar JWT em Rota Específica

```yaml
services:
  public-service:
    baseUrl: http://localhost:5000
    # Sem jwt_enabled

routes:
  - path: /public/profile
    methods: GET
    service: public-service
    jwt_enabled: true  # <-- Força JWT apenas nesta rota
    jwt_secret: "secret-desta-rota"  # (opcional)
```

## Prioridade dos Secrets

O sistema usa a seguinte ordem de prioridade para escolher o secret:

1. **Secret da rota** (`route.jwt_secret`)
2. **Secret do serviço** (`service.jwt_secret`)
3. **Secret global** (`gateway.jwt_secret`)

```yaml
gateway:
  jwt_secret: "global-secret"  # Prioridade 3

services:
  api-service:
    baseUrl: http://localhost:3333
    jwt_secret: "service-secret"  # Prioridade 2

routes:
  - path: /api/special
    methods: GET
    service: api-service
    jwt_enabled: true
    jwt_secret: "route-secret"  # Prioridade 1 (usado)
```

## Formato do Token

O middleware espera o token no header `Authorization` no formato:

```
Authorization: Bearer <token>
```

## Exemplos de Requisição

### ✅ Requisição com JWT Válido

```bash
curl -X GET http://localhost:4000/store/orders \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Resposta:** `200 OK` + dados da rota

### ❌ Requisição sem Token

```bash
curl -X GET http://localhost:4000/store/orders
```

**Resposta:**
```json
{
  "error": "Unauthorized",
  "message": "No authorization token provided",
  "statusCode": 401,
  "timestamp": "2024-12-16T15:00:00.000Z"
}
```

### ❌ Token Inválido

**Resposta:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid token signature",
  "statusCode": 401,
  "timestamp": "2024-12-16T15:00:00.000Z"
}
```

### ❌ Token Expirado

**Resposta:**
```json
{
  "error": "Unauthorized",
  "message": "Token expired",
  "statusCode": 401,
  "timestamp": "2024-12-16T15:00:00.000Z"
}
```

## Acesso ao Payload do Token

Quando o token é válido, o payload decodificado fica disponível em:

```typescript
(req as any).user  // Payload do JWT
(req as any).token // Token original (string)
```

Você pode acessar isso em middlewares customizados ou handlers.

## Logs

O sistema mostra logs claros sobre quando o JWT está ativado:

```
🔐 JWT enabled for route: /store/orders
🔐 JWT enabled (service default) for route: /store/products
⚠️  JWT disabled for route: /store/public/catalog
```

## Exemplo Completo

```yaml
gateway:
  jwt_secret: "fallback-secret-global"

services:
  auth-service:
    baseUrl: http://localhost:4000

  store-service:
    baseUrl: http://localhost:3333
    jwt_enabled: true
    jwt_secret: "store-secret-123"

routes:
  # Rota pública - sem JWT
  - path: /auth/sign-in
    methods: POST
    service: auth-service

  # Rota protegida - JWT do serviço
  - path: /store/orders
    methods: [GET, POST]
    service: store-service

  # Rota pública dentro do store - JWT desabilitado
  - path: /store/public/catalog
    methods: GET
    service: store-service
    jwt_disabled: true

  # Rota admin - JWT forçado com secret próprio
  - path: /admin/*
    methods: any
    service: store-service
    jwt_enabled: true
    jwt_secret: "admin-secret-xyz"
```

## Troubleshooting

### Erro: "JWT enabled but no secret configured"

**Causa:** Rota ou serviço tem `jwt_enabled: true` mas nenhum secret foi definido.

**Solução:** Adicione `jwt_secret` no gateway, service ou rota.

### Token sempre rejeitado

**Causa:** Secret incorreto.

**Solução:** Verifique se o token foi gerado com o mesmo secret configurado no gateway.

---

✅ Sistema JWT completo e configurável!

