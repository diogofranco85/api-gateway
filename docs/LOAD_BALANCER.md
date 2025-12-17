# ⚖️ Load Balancer - Documentação

## 📖 Visão Geral

O **Load Balancer** permite distribuir requisições entre múltiplas instâncias de um mesmo microserviço, melhorando disponibilidade, escalabilidade e performance do sistema.

## 🎯 Objetivo

O Load Balancer oferece:
- **Alta Disponibilidade**: Se um servidor falhar, outros continuam atendendo
- **Escalabilidade Horizontal**: Adicione mais servidores para aumentar capacidade
- **Distribuição de Carga**: Distribui requisições de forma inteligente
- **Zero Downtime**: Deploy sem interrupção do serviço

## ⚙️ Configuração

### Configuração Básica

Em vez de usar `baseUrl` (URL única), use `baseUrls` (array de URLs):

```yaml
services:
  meu-servico:
    baseUrls:
      - http://server-1:3000
      - http://server-2:3000
      - http://server-3:3000
    loadBalancer: round-robin  # Estratégia (opcional, padrão: round-robin)
```

### Estratégias Disponíveis

| Estratégia | Descrição | Quando Usar |
|------------|-----------|-------------|
| **round-robin** | Distribui requisições em ordem circular | **Recomendado** - Simples e eficiente para servidores similares |
| **random** | Seleciona servidor aleatoriamente | Boa distribuição estatística, útil para testes |
| **least-connections** | Escolhe servidor com menos conexões ativas | Requisições com duração variável |

## 🔄 Estratégias Detalhadas

### 1. Round Robin (Padrão)

Distribui requisições de forma circular entre os servidores.

**Funcionamento:**
```
Requisição 1 → Server 1
Requisição 2 → Server 2
Requisição 3 → Server 3
Requisição 4 → Server 1 (volta ao início)
Requisição 5 → Server 2
...
```

**Configuração:**
```yaml
services:
  api-service:
    baseUrls:
      - http://api-1:3000
      - http://api-2:3000
      - http://api-3:3000
    loadBalancer: round-robin
```

**Logs:**
```
🔄 Load Balancer (Round Robin): api-service → http://api-1:3000 [1/3]
🔄 Load Balancer (Round Robin): api-service → http://api-2:3000 [2/3]
🔄 Load Balancer (Round Robin): api-service → http://api-3:3000 [3/3]
```

**Vantagens:**
- ✅ Distribuição uniforme
- ✅ Simples e previsível
- ✅ Baixo overhead
- ✅ Funciona bem com servidores de capacidade similar

**Desvantagens:**
- ❌ Não considera carga atual dos servidores
- ❌ Pode sobrecarregar servidores mais lentos

### 2. Random

Seleciona um servidor aleatoriamente para cada requisição.

**Configuração:**
```yaml
services:
  api-service:
    baseUrls:
      - http://api-1:3000
      - http://api-2:3000
      - http://api-3:3000
    loadBalancer: random
```

**Logs:**
```
🎲 Load Balancer (Random): http://api-2:3000 [2/3]
🎲 Load Balancer (Random): http://api-1:3000 [1/3]
🎲 Load Balancer (Random): http://api-2:3000 [2/3]
```

**Vantagens:**
- ✅ Distribuição estatisticamente uniforme em longo prazo
- ✅ Simples de implementar
- ✅ Sem estado mantido

**Desvantagens:**
- ❌ Pode ter distribuição desigual em curto prazo
- ❌ Não considera carga dos servidores

**Quando Usar:**
- Testes de carga
- Servidores homogêneos
- Ambientes sem requisitos de distribuição exata

### 3. Least Connections

Seleciona o servidor com menos conexões ativas no momento.

**Funcionamento:**
```
Estado inicial:
Server 1: 0 conexões
Server 2: 0 conexões
Server 3: 0 conexões

Requisição 1 → Server 1 (0 conexões) → Server 1 agora tem 1
Requisição 2 → Server 2 (0 conexões) → Server 2 agora tem 1
Requisição 1 termina → Server 1 volta para 0
Requisição 3 → Server 1 (0 conexões) → Server 1 agora tem 1
```

**Configuração:**
```yaml
services:
  api-service:
    baseUrls:
      - http://api-1:3000
      - http://api-2:3000
      - http://api-3:3000
    loadBalancer: least-connections
```

**Logs:**
```
📊 Load Balancer (Least Connections): api-service → http://api-1:3000 [0 conexões ativas]
📊 Load Balancer (Least Connections): api-service → http://api-2:3000 [0 conexões ativas]
📊 Load Balancer (Least Connections): api-service → http://api-1:3000 [1 conexões ativas]
```

**Vantagens:**
- ✅ Considera carga atual dos servidores
- ✅ Ideal para requisições de duração variável
- ✅ Evita sobrecarregar servidores lentos

**Desvantagens:**
- ❌ Overhead de manter contadores
- ❌ Mais complexo que round-robin

**Quando Usar:**
- Requisições com tempo de processamento muito variável
- Upload/download de arquivos
- Requisições longas (relatórios, processamento pesado)
- Servidores de capacidades diferentes

## 📊 Exemplos de Configuração

### Configuração Simples (2 servidores)

```yaml
services:
  user-service:
    baseUrls:
      - http://user-api-1:3000
      - http://user-api-2:3000
    loadBalancer: round-robin
```

### Alta Disponibilidade (4 servidores)

```yaml
services:
  payment-service:
    baseUrls:
      - http://payment-1:3000
      - http://payment-2:3000
      - http://payment-3:3000
      - http://payment-4:3000
    loadBalancer: least-connections
    timeout: 5000
    circuit_breaker:
      enabled: true
      errorThresholdPercentage: 30
```

### Cluster Kubernetes

```yaml
services:
  api-service:
    baseUrls:
      - http://api-deployment-0.api-service.default.svc.cluster.local:3000
      - http://api-deployment-1.api-service.default.svc.cluster.local:3000
      - http://api-deployment-2.api-service.default.svc.cluster.local:3000
    loadBalancer: round-robin
```

### Múltiplos Data Centers

```yaml
services:
  geo-distributed-api:
    baseUrls:
      - http://api-us-east.example.com:3000
      - http://api-us-west.example.com:3000
      - http://api-eu-west.example.com:3000
    loadBalancer: round-robin
    timeout: 15000
```

## 🔗 Integração com Circuit Breaker

Load Balancer funciona perfeitamente com Circuit Breaker:

```yaml
services:
  external-api:
    baseUrls:
      - http://api-replica-1.external.com
      - http://api-replica-2.external.com
      - http://api-replica-3.external.com
    loadBalancer: round-robin
    circuit_breaker:
      enabled: true
      timeout: 10000
      errorThresholdPercentage: 50
      resetTimeout: 30000
```

**Como funciona:**
1. Load Balancer seleciona um servidor
2. Circuit Breaker protege a requisição
3. Se o servidor falhar repetidamente, circuit breaker abre
4. Próximas requisições vão para outros servidores automaticamente

## 📈 Monitoramento

### Logs de Load Balancing

O gateway emite logs detalhados:

```bash
# Round Robin
🔄 Load Balancer (Round Robin): api-service → http://api-1:3000 [1/3]

# Random
🎲 Load Balancer (Random): http://api-2:3000 [2/3]

# Least Connections
📊 Load Balancer (Least Connections): api-service → http://api-1:3000 [2 conexões ativas]
```

### Exemplo de Fluxo Completo

```bash
# Requisição recebida
🔄 Proxying: GET /api/users → http://api-1:3000/api/users

# Load balancer selecionou servidor
🔄 Load Balancer (Round Robin): api-service → http://api-1:3000 [1/3]

# Circuit breaker sendo usado
⚡ Usando Circuit Breaker para: api-service

# Resposta bem-sucedida
✅ Proxy success: 200
```

## 🎯 Melhores Práticas

### 1. Use Round Robin para Simplicidade

Para a maioria dos casos, round-robin é suficiente:

```yaml
services:
  default-service:
    baseUrls:
      - http://server-1:3000
      - http://server-2:3000
    loadBalancer: round-robin  # Simples e eficaz
```

### 2. Least Connections para Requisições Pesadas

Se tem requisições longas ou variáveis:

```yaml
services:
  report-service:
    baseUrls:
      - http://report-1:3000
      - http://report-2:3000
    loadBalancer: least-connections  # Melhor para carga desigual
```

### 3. Combine com Health Checks

Embora o gateway não faça health checks ativos, o circuit breaker atua como health check passivo:

```yaml
services:
  monitored-service:
    baseUrls:
      - http://server-1:3000
      - http://server-2:3000
    loadBalancer: round-robin
    circuit_breaker:
      enabled: true
      volumeThreshold: 5  # Detecta problemas rapidamente
```

### 4. Servidores Homogêneos

Certifique-se de que todos os servidores têm capacidade similar:

```yaml
# ✅ BOM: Todos os servidores idênticos
baseUrls:
  - http://api-pod-1:3000
  - http://api-pod-2:3000
  - http://api-pod-3:3000

# ❌ EVITE: Capacidades muito diferentes
# baseUrls:
#   - http://small-instance:3000    # 1 CPU
#   - http://large-instance:3000    # 8 CPUs
```

### 5. Quantidade de Servidores

**Mínimo:** 2 servidores para alta disponibilidade
**Ideal:** 3-5 servidores para boa distribuição
**Máximo:** Sem limite, mas considere usar um load balancer dedicado (NGINX, HAProxy) para >10 servidores

```yaml
# Configuração ideal
services:
  production-api:
    baseUrls:
      - http://api-1:3000
      - http://api-2:3000
      - http://api-3:3000  # 3 servidores = bom equilíbrio
```

## 🧪 Testando Load Balancer

### Teste Manual

1. **Configure múltiplas URLs** no `routes.yaml`
2. **Inicie o gateway**: `npm run dev`
3. **Faça múltiplas requisições**:

```bash
for i in {1..10}; do
  curl http://localhost:3000/api/test
  sleep 0.5
done
```

4. **Observe os logs** para ver a distribuição:

```
🔄 Load Balancer (Round Robin): test-service → http://server-1:3000 [1/3]
🔄 Load Balancer (Round Robin): test-service → http://server-2:3000 [2/3]
🔄 Load Balancer (Round Robin): test-service → http://server-3:3000 [3/3]
🔄 Load Balancer (Round Robin): test-service → http://server-1:3000 [1/3]
```

### Script de Teste

```bash
#!/bin/bash

GATEWAY_URL="http://localhost:3000"
ENDPOINT="/api/test"
NUM_REQUESTS=30

echo "🧪 Testando Load Balancer..."
echo "Endpoint: $ENDPOINT"
echo "Requisições: $NUM_REQUESTS"
echo ""

for i in $(seq 1 $NUM_REQUESTS); do
  echo -n "Req $i: "
  curl -s "$GATEWAY_URL$ENDPOINT" -o /dev/null -w "Status: %{http_code}\n"
  sleep 0.2
done

echo ""
echo "✅ Teste concluído! Verifique os logs do gateway para ver a distribuição."
```

## 🔧 Troubleshooting

### Load Balancer sempre escolhe o mesmo servidor

**Causa:** Você pode estar usando `baseUrl` em vez de `baseUrls`.

**Solução:**
```yaml
# ❌ Errado
baseUrl: http://server-1:3000

# ✅ Correto
baseUrls:
  - http://server-1:3000
  - http://server-2:3000
```

### Distribuição desigual com Random

**Causa:** Random pode ter distribuição desigual em curto prazo.

**Solução:** Use `round-robin` para distribuição uniforme garantida:
```yaml
loadBalancer: round-robin
```

### Least Connections não funciona como esperado

**Causa:** Requisições muito rápidas podem não mostrar diferença.

**Solução:** Least connections é mais útil para requisições longas. Para requisições rápidas, use round-robin:
```yaml
loadBalancer: round-robin  # Melhor para requisições rápidas
```

### Um servidor está recebendo mais carga

**Verificações:**
1. Confirme que `baseUrls` está corretamente configurado
2. Verifique os logs para ver a seleção de servidores
3. Certifique-se de que todos os servidores estão respondendo
4. Se usando least-connections, um servidor pode estar mais lento

## 🚀 Deployment

### Deploy sem Downtime

1. **Adicione novo servidor** antes de remover o antigo:

```yaml
# Passo 1: Adicione server-4
baseUrls:
  - http://server-1:3000
  - http://server-2:3000
  - http://server-3:3000
  - http://server-4:3000  # Novo

# Passo 2: Depois que server-4 estiver estável, remova server-1
baseUrls:
  - http://server-2:3000
  - http://server-3:3000
  - http://server-4:3000
```

2. **Reload do gateway**: O gateway precisa ser reiniciado para pegar mudanças no YAML.

### Blue-Green Deployment

```yaml
# Durante deploy:
services:
  api-service:
    baseUrls:
      - http://blue-api-1:3000   # Versão antiga
      - http://blue-api-2:3000   # Versão antiga
      - http://green-api-1:3000  # Versão nova
      - http://green-api-2:3000  # Versão nova

# Após validação, remova versão antiga:
services:
  api-service:
    baseUrls:
      - http://green-api-1:3000
      - http://green-api-2:3000
```

## 📚 Referências

- [Load Balancing Algorithms](https://www.nginx.com/resources/glossary/load-balancing/)
- [Round Robin vs Least Connections](https://www.f5.com/services/resources/glossary/load-balancer)
- [High Availability Best Practices](https://docs.aws.amazon.com/whitepapers/latest/real-time-communication-on-aws/high-availability-and-scalability-on-aws.html)

## 🤝 Suporte

Se tiver dúvidas ou problemas com Load Balancer:
1. Verifique os logs do gateway para ver a seleção de servidores
2. Confirme que todos os servidores estão acessíveis
3. Teste com round-robin antes de usar estratégias mais complexas
4. Combine com circuit breaker para maior resiliência

---

**Dica:** Round Robin é a escolha certa para 90% dos casos. Use least-connections apenas se tiver requisições com duração muito variável.

