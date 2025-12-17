#!/bin/bash

# Script para testar Circuit Breaker
# Faz múltiplas requisições para testar o comportamento do circuit breaker

set -e

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
ENDPOINT="${ENDPOINT:-/store/products}"
NUM_REQUESTS="${NUM_REQUESTS:-20}"
SLEEP_TIME="${SLEEP_TIME:-0.5}"

echo "🧪 Testando Circuit Breaker"
echo "================================"
echo "Gateway URL: $GATEWAY_URL"
echo "Endpoint: $ENDPOINT"
echo "Número de requisições: $NUM_REQUESTS"
echo "================================"
echo ""

# Contador de status codes
declare -A status_counts

echo "📊 Executando requisições..."
echo ""

for i in $(seq 1 $NUM_REQUESTS); do
  echo -n "Requisição $i/$NUM_REQUESTS: "
  
  # Faz a requisição e captura o status code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$GATEWAY_URL$ENDPOINT" || echo "000")
  
  # Incrementa contador
  status_counts[$http_code]=$((${status_counts[$http_code]:-0} + 1))
  
  # Exibe resultado
  case $http_code in
    200)
      echo "✅ $http_code OK"
      ;;
    503)
      echo "🔴 $http_code Service Unavailable (Circuit Breaker Aberto)"
      ;;
    504)
      echo "⏱️  $http_code Gateway Timeout"
      ;;
    000)
      echo "❌ Falha na conexão"
      ;;
    *)
      echo "⚠️  $http_code"
      ;;
  esac
  
  sleep $SLEEP_TIME
done

echo ""
echo "================================"
echo "📈 Resumo dos Resultados"
echo "================================"

for code in "${!status_counts[@]}"; do
  count=${status_counts[$code]}
  percentage=$((count * 100 / NUM_REQUESTS))
  
  case $code in
    200)
      echo "✅ $code OK: $count requisições ($percentage%)"
      ;;
    503)
      echo "🔴 $code Service Unavailable: $count requisições ($percentage%)"
      ;;
    504)
      echo "⏱️  $code Gateway Timeout: $count requisições ($percentage%)"
      ;;
    000)
      echo "❌ Falha na conexão: $count requisições ($percentage%)"
      ;;
    *)
      echo "⚠️  $code: $count requisições ($percentage%)"
      ;;
  esac
done

echo ""
echo "================================"
echo "💡 Dicas:"
echo "================================"
echo "- Se viu 503 (Service Unavailable), o circuit breaker foi ativado"
echo "- Verifique os logs do gateway para ver as transições de estado"
echo "- Aguarde o resetTimeout e teste novamente para ver a recuperação"
echo ""
echo "✅ Teste concluído!"

