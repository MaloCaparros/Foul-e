import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { anthropicAi } from './coach/ai.js';

const config = loadConfig();
const db = await openDb(config);
const applied = await migrate(db);
if (applied.length) console.log(`[db] migrations appliquées : ${applied.join(', ')}`);
await purgeExpiredSessions(db);
const purge = setInterval(() => purgeExpiredSessions(db).catch(() => {}), 6 * 3600 * 1000);
purge.unref();

const ai = config.anthropicApiKey ? anthropicAi(config.anthropicApiKey, config.aiModel) : null;
const app = await buildApp({ db, config, ai, logger: true });
await app.listen({ port: config.port, host: config.host });
console.log(`[foulée] base : ${db.kind}${config.databaseUrl ? '' : ` (${config.dataDir})`} · génération Claude : ${ai ? config.aiModel : 'désactivée (ANTHROPIC_API_KEY absente)'}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
