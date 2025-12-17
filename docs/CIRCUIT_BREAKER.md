# Circuit Breaker - Documentação

## 📖 Visão Geral

O **Circuit Breaker** é um padrão de design implementado neste API Gateway para aumentar a resiliência e disponibilidade do sistema. Ele protege seus microserviços de cascatas de falhas, evitando sobrecarga em serviços instáveis.

## 🎯 Objetivo

O Circuit Breaker funciona como um disjuntor elétrico:
- **Monitora** as requisições para detectar falhas
- **Abre o circuito** quando muitas falhas são detectadas
- **Evita** requisições desnecessárias para serviços com problemas
- **Tenta fechar** o circuito automaticamente após um período

## 🔄 Estados do Circuit Breaker

### 1. 🟢 FECHADO (Closed)
- **Estado normal** de operação
- Todas as requisições passam normalmente
- Contabiliza sucessos e falhas
- Se atingir o threshold de erros → vai para ABERTO

### 2. 🔴 ABERTO (Open)
- **Circuito aberto** - requisições são bloqueadas imediatamente
- Retorna erro `503 Service Unavailable` sem tentar chamar o serviço
- Reduz carga no serviço problemático
- Após `resetTimeout` → vai para MEIO-ABERTO

### 3. 🟡 MEIO-ABERTO (Half-Open)
- **Tentativa de recuperação**
- Permite algumas requisições de teste
- Se as requisições de teste **sucederem** → volta para FECHADO
- Se as requisições de teste **falharem** → volta para ABERTO

## ⚙️ Configuração

### Habilitando Circuit Breaker

No arquivo `routes.yaml`, adicione a configuração dentro de cada serviço:

```yaml
services:
  meu-servico:
    baseUrl: http://localhost:3000
    circuit_breaker:
      enabled: true                    # Habilita o circuit breaker
      timeout: 10000                   # Timeout em ms (padrão: 10000)
      errorThresholdPercentage: 50     # % de erros para abrir (padrão: 50)
      resetTimeout: 30000              # Tempo para tentar fechar em ms (padrão: 30000)
      volumeThreshold: 10              # Mínimo de requisições para avaliar (padrão: 10)
```

### Parâmetros de Configuração

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `enabled` | boolean | `false` | Habilita/desabilita o circuit breaker para o serviço |
| `timeout` | number | `10000` | Timeout em milissegundos antes de considerar a requisição como falha |
| `errorThresholdPercentage` | number | `50` | Percentual de erros necessário para abrir o circuito (0-100) |
| `resetTimeout` | number | `30000` | Tempo em ms antes de tentar fechar o circuito novamente |
| `volumeThreshold` | number | `10` | Número mínimo de requisições antes de avaliar o threshold de erros |

## 📊 Exemplos de Configuração

### Configuração Conservadora (Alta Tolerância)
Ideal para serviços menos críticos ou em fase de teste:

```yaml
circuit_breaker:
  enabled: true
  timeout: 15000                   # 15 segundos de timeout
  errorThresholdPercentage: 70     # Aceita até 70% de erros
  resetTimeout: 60000              # Espera 1 minuto antes de testar
  volumeThreshold: 20              # Avalia após 20 requisições
```

### Configuração Agressiva (Baixa Tolerância)
Ideal para serviços críticos que precisam de resposta rápida:

```yaml
circuit_breaker:
  enabled: true
  timeout: 5000                    # 5 segundos de timeout
  errorThresholdPercentage: 30     # Abre com 30% de erros
  resetTimeout: 10000              # Testa novamente após 10 segundos
  volumeThreshold: 5               # Avalia após apenas 5 requisições
```

### Configuração Balanceada (Recomendada)
Ideal para maioria dos casos:

```yaml
circuit_breaker:
  enabled: true
  timeout: 10000                   # 10 segundos
  errorThresholdPercentage: 50     # 50% de erros
  resetTimeout: 30000              # 30 segundos
  volumeThreshold: 10              # 10 requisições
```

## 🚨 Respostas de Erro

### Quando o Circuit Breaker está ABERTO

**Status:** `503 Service Unavailable`

```json
{
  "error": "Service Unavailable",
  "message": "Circuit breaker is open for meu-servico. Service is temporarily unavailable.",
  "statusCode": 503,
  "timestamp": "2024-12-17T10:30:45.123Z"
}
```

### O que fazer ao receber 503?

1. **Implemente Retry com Backoff** no cliente
2. **Cache** respostas quando possível
3. **Fallback** para dados em cache ou padrões
4. **Monitore** os logs do gateway para identificar o problema

## 📈 Monitoramento e Logs

O circuit breaker emite logs detalhados sobre mudanças de estado:

### Logs de Estado

```bash
# Inicialização
⚡ Circuit Breaker inicializado para serviço: meu-servico { timeout: 10000, errorThresholdPercentage: 50, ... }

# Durante operação
⚡ Usando Circuit Breaker para: meu-servico

# Mudanças de estado
🔴 Circuit Breaker ABERTO para serviço: meu-servico
🟡 Circuit Breaker MEIO-ABERTO para serviço: meu-servico (testando recuperação)
🟢 Circuit Breaker FECHADO para serviço: meu-servico (serviço recuperado)

# Fallback
⚠️  Circuit Breaker fallback acionado para serviço: meu-servico
```

## 🔍 Troubleshooting

### Circuit Breaker abrindo frequentemente

**Possíveis causas:**
- `errorThresholdPercentage` muito baixo
- `volumeThreshold` muito baixo
- Serviço realmente instável
- `timeout` muito agressivo

**Soluções:**
1. Aumente `errorThresholdPercentage` (ex: 50 → 70)
2. Aumente `volumeThreshold` (ex: 10 → 20)
3. Aumente `timeout` se as requisições são legitimamente lentas
4. Investigue logs do microserviço para identificar problemas

### Circuit Breaker não está abrindo quando deveria

**Possíveis causas:**
- `errorThresholdPercentage` muito alto
- `volumeThreshold` muito alto
- Circuit breaker não habilitado

**Soluções:**
1. Verifique se `enabled: true` está configurado
2. Reduza `errorThresholdPercentage` (ex: 70 → 50)
3. Reduza `volumeThreshold` (ex: 20 → 10)

### Demora muito para recuperar

**Possíveis causas:**
- `resetTimeout` muito alto

**Solução:**
- Reduza `resetTimeout` (ex: 60000 → 30000)

## 🎯 Melhores Práticas

### 1. Use Circuit Breaker em Serviços Externos
Sempre habilite para APIs externas ou microserviços de terceiros:

```yaml
services:
  api-externa:
    baseUrl: https://api-parceiro.com
    circuit_breaker:
      enabled: true
      timeout: 8000
      errorThresholdPercentage: 40
```

### 2. Ajuste por Criticidade
Serviços críticos devem ter configuração mais agressiva:

```yaml
services:
  servico-pagamento:
    baseUrl: http://payments:3000
    circuit_breaker:
      enabled: true
      timeout: 5000                  # Resposta rápida
      errorThresholdPercentage: 30   # Baixa tolerância
      resetTimeout: 15000            # Recuperação rápida
```

### 3. Combine com Timeout Apropriado
O `timeout` do circuit breaker deve ser menor ou igual ao `timeout` do serviço:

```yaml
services:
  meu-servico:
    baseUrl: http://localhost:3000
    timeout: 15000                    # Timeout geral do serviço
    circuit_breaker:
      enabled: true
      timeout: 10000                  # Timeout do circuit breaker
```

### 4. Monitore e Ajuste
- **Inicie com valores conservadores**
- **Monitore logs e métricas**
- **Ajuste gradualmente** baseado em dados reais

### 5. Documente seu Threshold
Mantenha documentação sobre por que escolheu determinados valores:

```yaml
services:
  analytics-service:
    baseUrl: http://analytics:3000
    # Analytics não é crítico, pode tolerar falhas
    circuit_breaker:
      enabled: true
      errorThresholdPercentage: 70   # Alta tolerância: analytics é nice-to-have
      volumeThreshold: 20
```

## 🧪 Testando Circuit Breaker

### Teste Manual

1. **Simule falhas** no microserviço (derrube o serviço temporariamente)
2. **Faça múltiplas requisições** para atingir o `volumeThreshold`
3. **Observe os logs** para ver o circuito abrindo
4. **Verifique** se novas requisições retornam 503 imediatamente
5. **Suba o serviço** novamente
6. **Aguarde** o `resetTimeout`
7. **Observe** o circuito indo para meio-aberto e depois fechando

### Script de Teste

```bash
#!/bin/bash
# Testa circuit breaker fazendo múltiplas requisições

GATEWAY_URL="http://localhost:3000"
ENDPOINT="/store/products"

echo "🧪 Testando Circuit Breaker..."

# Faz 20 requisições
for i in {1..20}; do
  echo "Requisição $i..."
  curl -s "$GATEWAY_URL$ENDPOINT" | jq .statusCode
  sleep 0.5
done

echo "✅ Teste concluído. Verifique os logs do gateway."
```

## 📚 Referências

- [Circuit Breaker Pattern - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Opossum Library](https://github.com/nodeshift/opossum)
- [Resilience Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)

## 🤝 Suporte

Se tiver dúvidas ou problemas com o Circuit Breaker:
1. Verifique os logs do gateway
2. Revise a configuração no `routes.yaml`
3. Consulte esta documentação
4. Ajuste os parâmetros conforme necessário

