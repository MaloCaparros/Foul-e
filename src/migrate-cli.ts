import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';

const db = await openDb(loadConfig());
const applied = await migrate(db);
console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
await db.close();
