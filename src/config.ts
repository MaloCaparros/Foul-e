export interface Config {
  port: number;
  host: string;
  /** URL PostgreSQL. Absente : base PostgreSQL embarquée (PGlite) stockée dans `dataDir`. */
  databaseUrl?: string;
  dataDir: string;
  production: boolean;
  sessionDays: number;
  allowRegistration: boolean;
  anthropicApiKey?: string;
  aiModel: string;
}

const bool = (v: string | undefined, dflt: boolean) => (v == null || v === '' ? dflt : !['0', 'false', 'no', 'off'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT invalide : ${env.PORT}`);
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR ?? './data/pgdata',
    production: env.NODE_ENV === 'production',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    aiModel: env.AI_MODEL || 'claude-opus-5-5',
  };
}
