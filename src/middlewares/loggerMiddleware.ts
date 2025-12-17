import { Request, Response, NextFunction } from 'express';
import { SENSITIVE_FIELDS } from '../config/sensitive-fields';

// Função para sanitizar objetos recursivamente
function sanitize(obj: any, sensitiveFields: string[] = SENSITIVE_FIELDS): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Não sanitiza strings diretamente
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, sensitiveFields));
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const lowerKey = key.toLowerCase();
        // Verifica se a chave é sensível
        const isSensitive = sensitiveFields.some(field =>
          lowerKey.includes(field.toLowerCase())
        );

        if (isSensitive) {
          sanitized[key] = '***REDACTED***';
        } else {
          sanitized[key] = sanitize(obj[key], sensitiveFields);
        }
      }
    }
    return sanitized;
  }

  return obj;
}

// Função para sanitizar headers (case-insensitive)
function sanitizeHeaders(headers: any, sensitiveFields: string[] = SENSITIVE_FIELDS): any {
  const sanitized: any = {};
  for (const key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some(field =>
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = headers[key];
      }
    }
  }
  return sanitized;
}

export default function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Sanitiza dados antes de logar
  const sanitizedBody = req.body ? sanitize(req.body) : undefined;
  const sanitizedHeaders = sanitizeHeaders(req.headers);

  // Log da Request
  console.log('\n🔵 ===== INCOMING REQUEST =====');
  console.log(`📘 Method: ${req.method}`);
  console.log(`📘 Path: ${req.path}`);
  console.log(`📘 Query:`, sanitize(req.query));
  console.log(`📘 Headers:`, JSON.stringify(sanitizedHeaders, null, 2));
  if (sanitizedBody && Object.keys(sanitizedBody).length > 0) {
    console.log(`📘 Body:`, JSON.stringify(sanitizedBody, null, 2));
  }

  // Captura a resposta original
  const originalSend = res.send;
  const originalJson = res.json;
  let responseBody: any;

  // Intercepta res.json()
  res.json = function (body: any) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  // Intercepta res.send()
  res.send = function (body: any) {
    if (!responseBody) {
      responseBody = body;
    }
    return originalSend.call(this, body);
  };

  // Quando a resposta terminar
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusColor = res.statusCode >= 400 ? '🔴' : '🟢';

    // Sanitiza resposta antes de logar
    const sanitizedResponseHeaders = sanitizeHeaders(res.getHeaders());
    let sanitizedResponseBody = responseBody;

    if (responseBody) {
      if (typeof responseBody === 'string') {
        try {
          const parsed = JSON.parse(responseBody);
          sanitizedResponseBody = JSON.stringify(sanitize(parsed), null, 2);
        } catch {
          sanitizedResponseBody = responseBody;
        }
      } else {
        sanitizedResponseBody = JSON.stringify(sanitize(responseBody), null, 2);
      }
    }

    console.log(`\n${statusColor} ===== OUTGOING RESPONSE =====`);
    console.log(`${statusColor} Status: ${res.statusCode}`);
    console.log(`${statusColor} Duration: ${duration}ms`);
    console.log(`${statusColor} Headers:`, JSON.stringify(sanitizedResponseHeaders, null, 2));
    if (sanitizedResponseBody) {
      console.log(`${statusColor} Body:`, sanitizedResponseBody);
    }
    console.log('================================\n');
  });

  next();
}

// Exporta funções úteis para outros módulos
export { sanitize, sanitizeHeaders, SENSITIVE_FIELDS };