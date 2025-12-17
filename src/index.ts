import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import { Gateway } from './gateway';


console.log('****************************************************\n');
console.log('              FRANI API GATEWAY\n');
console.log('****************************************************\n');

const app = express();
app.use(express.json());

const gateway = new Gateway(app);
const stage = process.env.STAGE || 'local';
const routesPath = path.resolve(__dirname, 'routes', `routes.${stage}.yaml`);
console.log(`🔍 Carregando rotas do arquivo: ${routesPath}`);
gateway.loadFromYaml(routesPath);

// Middleware para detectar Method Not Allowed
// Deve vir antes do 404
app.use((req, res, next) => {
  // Se chegou aqui, nenhuma rota respondeu
  // Vamos verificar se existe a rota mas com outro método
  const router = (app as any)._router;

  if (router && router.stack) {
    // Procura por rotas que batem com o path mas não com o método
    const matchingRoutes = router.stack.filter((layer: any) => {
      if (layer.route) {
        // Verifica se o path bate
        const pathRegex = layer.regexp;
        if (pathRegex.test(req.path)) {
          // Verifica se o método não está disponível
          return !layer.route.methods[req.method.toLowerCase()];
        }
      }
      return false;
    });

    if (matchingRoutes.length > 0) {
      // Coleta os métodos permitidos
      const allowedMethods = new Set<string>();
      matchingRoutes.forEach((layer: any) => {
        if (layer.route && layer.route.methods) {
          Object.keys(layer.route.methods).forEach(method => {
            if (layer.route.methods[method]) {
              allowedMethods.add(method.toUpperCase());
            }
          });
        }
      });

      return res.status(405)
        .set('Allow', Array.from(allowedMethods).join(', '))
        .json({
          error: 'Method Not Allowed',
          message: `Method ${req.method} is not allowed for ${req.path}`,
          statusCode: 405,
          allowedMethods: Array.from(allowedMethods),
          timestamp: new Date().toISOString(),
          path: req.path
        });
    }
  }

  next();
});

// Handler 404 - Deve vir depois de todas as rotas
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// Handler de erros global
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Error:', err);

  // Trata erro 405 Method Not Allowed do Express
  if (err.status === 405 || err.statusCode === 405) {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: `Method ${req.method} is not allowed for ${req.path}`,
      statusCode: 405,
      allowedMethods: err.allowedMethods || [],
      timestamp: new Date().toISOString(),
      path: req.path
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: err.name || 'Error',
    message: message,
    statusCode: statusCode,
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

app.set('server', "frani-gateway");
const PORT = process.env.PORT || 3000;
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Gateway rodando em http://0.0.0.0:${PORT}`);
  console.log(`📌 Pressione CTRL+C para parar o servidor`);
});

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Erro: Porta ${PORT} já está em uso`);
  } else {
    console.error(`❌ Erro ao iniciar servidor:`, error);
  }
  process.exit(1);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM recebido, encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n⚠️  SIGINT recebido, encerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor encerrado com sucesso');
    process.exit(0);
  });
});