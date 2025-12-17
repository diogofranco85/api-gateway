# Scripts de Teste e Utilitários

## 🧪 test-circuit-breaker.sh

Script para testar o comportamento do Circuit Breaker fazendo múltiplas requisições ao gateway.

### Uso Básico

```bash
./scripts/test-circuit-breaker.sh
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `GATEWAY_URL` | `http://localhost:3000` | URL do API Gateway |
| `ENDPOINT` | `/store/products` | Endpoint para testar |
| `NUM_REQUESTS` | `20` | Número de requisições a fazer |
| `SLEEP_TIME` | `0.5` | Tempo de espera entre requisições (segundos) |

### Exemplos

**Teste básico:**
```bash
./scripts/test-circuit-breaker.sh
```

**Teste com mais requisições:**
```bash
NUM_REQUESTS=50 ./scripts/test-circuit-breaker.sh
```

**Teste em endpoint diferente:**
```bash
ENDPOINT=/api/users NUM_REQUESTS=30 ./scripts/test-circuit-breaker.sh
```

**Teste mais rápido:**
```bash
NUM_REQUESTS=100 SLEEP_TIME=0.1 ./scripts/test-circuit-breaker.sh
```

### Interpretando os Resultados

#### Status Codes

- **200 OK**: Requisição bem-sucedida
- **503 Service Unavailable**: Circuit breaker está aberto
- **504 Gateway Timeout**: Serviço demorou muito para responder
- **000 Falha na conexão**: Não conseguiu conectar ao gateway

#### Exemplo de Saída

```
🧪 Testando Circuit Breaker
================================
Gateway URL: http://localhost:3000
Endpoint: /store/products
Número de requisições: 20
================================

📊 Executando requisições...

Requisição 1/20: ✅ 200 OK
Requisição 2/20: ✅ 200 OK
Requisição 3/20: ⏱️  504 Gateway Timeout
Requisição 4/20: ⏱️  504 Gateway Timeout
Requisição 5/20: ⏱️  504 Gateway Timeout
Requisição 6/20: 🔴 503 Service Unavailable (Circuit Breaker Aberto)
Requisição 7/20: 🔴 503 Service Unavailable (Circuit Breaker Aberto)
...

================================
📈 Resumo dos Resultados
================================
✅ 200 OK: 2 requisições (10%)
⏱️  504 Gateway Timeout: 3 requisições (15%)
🔴 503 Service Unavailable: 15 requisições (75%)
```

### Como Testar o Circuit Breaker

1. **Configure o circuit breaker** no `routes.yaml`:

```yaml
services:
  store-service:
    baseUrl: http://localhost:3333
    circuit_breaker:
      enabled: true
      timeout: 5000
      errorThresholdPercentage: 30
      resetTimeout: 30000
      volumeThreshold: 5
```

2. **Simule falhas** no microserviço (pare o serviço ou faça-o demorar muito)

3. **Execute o script**:

```bash
./scripts/test-circuit-breaker.sh
```

4. **Observe os logs** do gateway para ver as transições:

```
🔄 Proxying: GET /store/products → http://localhost:3333/store/products
⚡ Usando Circuit Breaker para: store-service
⏱️  504 Gateway Timeout
🔴 Circuit Breaker ABERTO para serviço: store-service
🔴 503 Service Unavailable (Circuit Breaker Aberto)
```

5. **Aguarde o resetTimeout** (30s no exemplo) e execute novamente para ver a recuperação:

```
🟡 Circuit Breaker MEIO-ABERTO para serviço: store-service (testando recuperação)
🟢 Circuit Breaker FECHADO para serviço: store-service (serviço recuperado)
```

### Dicas

- Use `NUM_REQUESTS` maior que `volumeThreshold` para garantir que o threshold seja avaliado
- Ajuste `SLEEP_TIME` conforme necessário para dar tempo ao serviço responder
- Monitore os logs do gateway em paralelo: `npm run dev` em outro terminal
- Para testar recuperação, primeiro cause falhas, aguarde o `resetTimeout`, depois volte o serviço

## 📝 Adicionando Novos Scripts

Ao adicionar novos scripts:

1. Torne-os executáveis: `chmod +x scripts/seu-script.sh`
2. Documente-os neste README
3. Use variáveis de ambiente para configurações
4. Adicione mensagens claras e emojis para melhor UX
5. Inclua exemplos de uso

