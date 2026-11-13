import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { Credentials } from './schemas.js';
import { HttpError } from './errors.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const COOKIE = 'foulee_sid';

export interface AuthUser {
  id: string;
  email: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N!, r: +r!, p: +p! });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function registerAuth(app: FastifyInstance, db: Db, cfg: Config) {
  const maxAge = cfg.sessionDays * 86400;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: cfg.production, maxAge };

  async function startSession(reply: FastifyReply, userId: string) {
    const token = randomBytes(32).toString('base64url');
    await db.query(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [sha256(token), userId, maxAge]);
    reply.setCookie(COOKIE, token, cookieOpts);
  }

  // Identifie l'utilisateur à partir du cookie de session, sur toutes les routes /api.
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[COOKIE];
    if (!token || !req.url.startsWith('/api/')) return;
    const { rows } = await db.query<{ id: string; email: string; stale: boolean }>(
      `SELECT u.id, u.email, s.last_seen_at < now() - interval '1 day' AS stale
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) return;
    req.user = { id: row.id, email: row.email };
    // Session glissante : prolongée au plus une fois par jour.
    if (row.stale) await db.query(`UPDATE auth_sessions SET last_seen_at = now(), expires_at = now() + make_interval(secs => $2) WHERE token_hash = $1`, [sha256(token), maxAge]);
  });

  // Protection CSRF : une requête qui modifie des données doit venir de la même origine.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (!origin) return;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'bad_origin', 'Origine de la requête refusée.');
    }
    if (host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Origine de la requête refusée.');
  });

  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    if (!cfg.allowRegistration) throw new HttpError(403, 'registration_closed', 'Les inscriptions sont fermées sur ce serveur.');
    const { email, password } = Credentials.parse(req.body);
    const hash = await hashPassword(password);
    const { rows } = await db.query<AuthUser>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (lower(email)) DO NOTHING RETURNING id, email`,
      [email, hash],
    );
    if (!rows[0]) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse.');
    await startSession(reply, rows[0].id);
    return reply.code(201).send({ user: rows[0] });
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const { email, password } = Credentials.parse(req.body);
    const { rows } = await db.query<AuthUser & { password_hash: string }>(`SELECT id, email, password_hash FROM users WHERE lower(email) = $1`, [email]);
    const u = rows[0];
    // Même coût et même réponse que le compte existe ou non.
    const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'bad_credentials', 'Adresse ou mot de passe incorrect.');
    await startSession(reply, u.id);
    return { user: { id: u.id, email: u.email } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await db.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: requireUser(req), registration: cfg.allowRegistration }));

  // Suppression du compte et de toutes ses données (cascade), mot de passe exigé.
  app.delete('/api/account', authLimit, async (req, reply) => {
    const user = requireUser(req);
    const password = String((req.body as any)?.password ?? '');
    const { rows } = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) throw new HttpError(401, 'bad_credentials', 'Mot de passe incorrect.');
    await db.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}

const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
  return req.user;
}

/** Supprime les sessions expirées (appelé au démarrage puis périodiquement). */
export const purgeExpiredSessions = (db: Db) => db.query(`DELETE FROM auth_sessions WHERE expires_at < now()`);
