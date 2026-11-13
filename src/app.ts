import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { registerAuth } from './auth.js';
import { registerData } from './routes/data.js';
import { registerAi } from './routes/ai.js';
import type { AiClient } from './coach/ai.js';
import { HttpError } from './errors.js';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export interface AppDeps {
  db: Db;
  config: Config;
  ai: AiClient | null;
  logger?: boolean;
}

export async function buildApp({ db, config, ai, logger = false }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: config.production, bodyLimit: 512 * 1024 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
    hsts: config.production,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api/') });

  // Une seule forme d'erreur pour toute l'API : { error: { code, message, details? } }.
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ champ: i.path.join('.'), message: i.message }));
      return reply.code(400).send({ error: { code: 'invalid_input', message: 'Données invalides.', details } });
    }
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Trop de requêtes, réessaie dans un instant.' } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: 'Requête invalide.' } });
    req.log.error(err);
    if (!logger) console.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Erreur interne du serveur.' } });
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, db: db.kind, ai: !!ai };
  });
  registerAuth(app, db, config);
  registerData(app, db, { aiEnabled: !!ai });
  registerAi(app, db, ai);

  await app.register(fastifyStatic, { root: WEB_DIR, cacheControl: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Route inconnue.' } });
    return reply.sendFile('index.html');
  });
  return app;
}
