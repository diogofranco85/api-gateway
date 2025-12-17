import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JWTPayload {
  [key: string]: any;
}

/**
 * Middleware de validação JWT
 * Verifica se o token é válido e anexa o payload decodificado em req.user
 */
export function createJWTMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extrai o token do header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authorization token provided',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    }

    // Verifica se é Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authorization format. Expected: Bearer <token>',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    }

    const token = parts[1];

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token is missing',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // Verifica e decodifica o token
      const decoded = jwt.verify(token, secret) as JWTPayload;

      // Anexa o payload ao request para uso posterior
      (req as any).user = decoded;
      (req as any).token = token;

      next();
    } catch (err: any) {
      console.error('❌ JWT Validation Error:', err.message);

      let message = 'Invalid token';
      if (err.name === 'TokenExpiredError') {
        message = 'Token expired';
      } else if (err.name === 'JsonWebTokenError') {
        message = 'Invalid token signature';
      } else if (err.name === 'NotBeforeError') {
        message = 'Token not active yet';
      }

      return res.status(401).json({
        error: 'Unauthorized',
        message,
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

export default createJWTMiddleware;
