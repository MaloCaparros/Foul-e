import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrate, openDb, type Db } from '../src/db.ts';
import type { AiClient } from '../src/coach/ai.ts';
import { AiError } from '../src/coach/ai.ts';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as coach from '../src/coach/prompts.ts';

/* Les tests tournent sur PGlite en mémoire, ou sur un vrai PostgreSQL si TEST_DATABASE_URL est défini. */
let db: Db, app: FastifyInstance, appNoAi: FastifyInstance;
const WEEK = '2026-11-09', TODAY = '2026-11-12';
const prompts: string[] = [];
let aiMode: 'ok' | 'refuse' = 'ok';
const fakeAi: AiClient = {
  async json(prompt, schema) {
    prompts.push(prompt);
    if (aiMode === 'refuse') throw new AiError('refused', 'refus');
    const session = { type: 'course', titre: 'Footing', duree: 40, intensite: 'facile', echauffement: 'Marche 5 min', blocs: [{ nom: '30 min en endurance', detail: 'Allure de conversation' }], retour: 'Étirements', conseil: 'Reste relâché' };
    const meal = { moment: 'Déjeuner', nom: 'Poulet et riz', ingredients: ['poulet 150 g', 'riz 70 g'], kcal: 560, prot: 45, temps: 20 };
    let out: unknown;
    if (schema === coach.TrainingOut) out = { focus: 'Régularité', jours: [0, 2, 4].map((jour) => ({ jour, ...session })) };
    else if (schema === coach.MealsOut) out = { jours: [0, 1, 2, 3, 4, 5, 6].map((jour) => ({ jour, repas: [meal] })), courses: [{ rayon: 'Viandes', items: ['poulet'] }], astuces: 'Cuis le riz en avance.' };
    else if (schema === coach.MealOut) out = { ...meal, nom: 'Saumon et quinoa' };
    else out = { ...session, titre: 'Footing allégé' };
    return schema.parse(out);
  },
  async text(prompt) { prompts.push(prompt); return 'Tu progresses bien.'; },
};

before(async () => {
  db = await openDb({ databaseUrl: process.env.TEST_DATABASE_URL });
  if (process.env.TEST_DATABASE_URL) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  assert.deepEqual(await migrate(db), ['001_init.sql']);
  assert.deepEqual(await migrate(db), [], 'les migrations ne sont appliquées qu\'une fois');
  const config = loadConfig({ PORT: '3000' });
  app = await buildApp({ db, config, ai: fakeAi });
  appNoAi = await buildApp({ db, config, ai: null });
});
after(async () => { await app.close(); await appNoAi.close(); await db.close(); });

/** Petit client : garde le cookie de session d'un utilisateur. */
function client(a: () => FastifyInstance = () => app) {
  let cookie = '';
  return async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await a().inject({ method: method as any, url, payload: body as any, headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie'];
    if (set) { const c = String(Array.isArray(set) ? set[0] : set).split(';')[0]!; cookie = c.endsWith('=') ? '' : c; }
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res };
  };
}
const PROFILE = { prenom: 'Alex', sexe: 'h', age: 30, taille: 178, poids: 82, poidsCible: 76, principal: 'poids', limitations: '', niveau: 'debutant', chrono5k: '', duree: 45,
  jours: [4, 0, 2, 2], materiel: ['aucun'], aime: 'poulet', deteste: 'chou', regime: 'omnivore', allergies: '', cuisine: 'rapide', collation: true, debut: '2026-10-26' };
const day = (type: string, i: number) => ({ day: i, type, titre: type === 'repos' ? 'Repos' : 'Séance', duree: type === 'repos' ? 0 : 40, intensite: 'facile', echauffement: '', blocs: [], retour: '', conseil: '' });
const plan = (week: string) => ({ weekKey: week, source: 'local', semaine: 1, focus: 'Base', days: [0, 1, 2, 3, 4, 5, 6].map((i) => day([0, 2, 4].includes(i) ? 'course' : 'repos', i)) });

const A = client(), B = client();

test('comptes : inscription, connexion, déconnexion', async () => {
  assert.equal((await A('GET', '/api/auth/me')).status, 401);
  assert.equal((await A('POST', '/api/auth/register', { email: 'a@example.com', password: 'court' })).status, 400);
  assert.equal((await A('POST', '/api/auth/register', { email: 'pas-un-email', password: 'motdepasse1' })).status, 400);
  const r = await A('POST', '/api/auth/register', { email: 'A@Example.com', password: 'motdepasse1' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'a@example.com');
  assert.match(String(r.raw.headers['set-cookie']), /HttpOnly/i);
  assert.match(String(r.raw.headers['set-cookie']), /SameSite=Lax/i);
  assert.equal((await A('GET', '/api/auth/me')).body.user.email, 'a@example.com');
  assert.equal((await B('POST', '/api/auth/register', { email: 'a@example.com', password: 'motdepasse2' })).status, 409, 'adresse déjà prise');
  assert.equal((await B('POST', '/api/auth/login', { email: 'a@example.com', password: 'mauvais-mdp' })).status, 401);
  assert.equal((await B('POST', '/api/auth/login', { email: 'inconnu@example.com', password: 'motdepasse1' })).status, 401);
  assert.equal((await A('POST', '/api/auth/logout')).status, 200);
  assert.equal((await A('GET', '/api/auth/me')).status, 401);
  assert.equal((await A('POST', '/api/auth/login', { email: 'a@example.com', password: 'motdepasse1' })).status, 200);
  assert.equal((await B('POST', '/api/auth/register', { email: 'b@example.com', password: 'motdepasse2' })).status, 201);
  const { rows } = await db.query('SELECT password_hash FROM users');
  assert.ok(rows.every((u) => u.password_hash.startsWith('scrypt$') && !u.password_hash.includes('motdepasse')), 'mots de passe hachés');
});

test('toutes les routes de données exigent une connexion', async () => {
  const anon = client();
  for (const [m, u] of [['GET', `/api/bootstrap?week=${WEEK}`], ['PUT', '/api/profile'], ['GET', '/api/sessions'], ['PUT', '/api/sessions/x'], ['PUT', '/api/weights/2026-11-12'], ['GET', '/api/export'], ['DELETE', '/api/data'], ['POST', '/api/ai/training'], ['GET', `/api/stats/weekly?week=${WEEK}`]] as const)
    assert.equal((await anon(m, u, {})).status, 401, `${m} ${u}`);
});

test('requête venant d\'une autre origine refusée', async () => {
  assert.equal((await A('PUT', '/api/weights/2026-11-12', { kg: 80 }, { origin: 'https://evil.example', host: 'localhost:3000' })).status, 403);
  assert.equal((await A('PUT', '/api/weights/2026-11-01', { kg: 83 }, { origin: 'http://localhost:3000', host: 'localhost:3000' })).status, 200);
});

test('profil : validation et enregistrement', async () => {
  assert.equal((await A('PUT', '/api/profile', { ...PROFILE, age: 7 })).status, 400);
  assert.equal((await A('PUT', '/api/profile', { ...PROFILE, jours: [] })).status, 400);
  const bad = await A('PUT', '/api/profile', { ...PROFILE, sexe: 'x' });
  assert.equal(bad.body.error.code, 'invalid_input');
  assert.equal(bad.body.error.details[0].champ, 'sexe');
  const ok = await A('PUT', '/api/profile', { ...PROFILE, inconnu: 'ignoré' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.profile.jours, [0, 2, 4], 'jours dédoublonnés et triés');
  assert.equal(ok.body.profile.inconnu, undefined);
  assert.equal((await A('GET', '/api/profile')).body.profile.prenom, 'Alex');
});

test('séances : allure calculée par le serveur, mise à jour, suppression', async () => {
  const s = { date: TODAY, type: 'course', titre: 'Footing', prevue: true, dureeMin: 41, distanceKm: 5.2, rpe: 6, ressenti: 'dur', note: 'ok', allureSec: 1 };
  const r = await A('PUT', `/api/sessions/${TODAY}`, s);
  assert.equal(r.status, 200);
  assert.equal(r.body.session.allureSec, 473, 'allure recalculée, valeur du client ignorée');
  assert.equal(r.body.session.weekKey, WEEK);
  assert.equal((await A('PUT', `/api/sessions/${TODAY}`, { ...s, dureeMin: 45 })).body.session.allureSec, 519, 'un second envoi met à jour la même séance');
  assert.equal((await A('PUT', `/api/sessions/velo_1`, { date: '2026-11-11', type: 'autre', titre: 'Vélo', dureeMin: 60, distanceKm: 22 })).body.session.allureSec, 0);
  for (const bad of [{ ...s, dureeMin: 9999 }, { ...s, type: 'ski' }, { ...s, date: '2026-02-30' }, { ...s, rpe: 11 }, { ...s, ressenti: 'bof' }])
    assert.equal((await A('PUT', '/api/sessions/bad', bad)).status, 400);
  assert.equal((await A('PUT', '/api/sessions/id avec espace', s)).status, 400);
  const list = (await A('GET', '/api/sessions?from=2026-11-12&to=2026-11-12')).body.sessions;
  assert.equal(list.length, 1);
  assert.equal(list[0].distanceKm, 5.2);
  assert.equal((await A('DELETE', '/api/sessions/velo_1')).status, 200);
  assert.equal((await A('GET', '/api/sessions')).body.sessions.length, 1);
});

test('pesées, mensurations, tests', async () => {
  assert.equal((await A('PUT', '/api/weights/2026-11-12', { kg: 81.44 })).body.weight.kg, 81.4);
  assert.equal((await A('PUT', '/api/weights/2026-11-12', { kg: 20 })).status, 400);
  assert.equal((await A('PUT', '/api/weights/12-11-2026', { kg: 80 })).status, 400);
  assert.equal((await A('PUT', '/api/measures/2026-11-12', {})).status, 400);
  assert.equal((await A('PUT', '/api/measures/2026-11-12', { taille: 92.5 })).status, 200);
  assert.deepEqual((await A('GET', '/api/measures')).body.measures, [{ date: '2026-11-12', taille: 92.5 }]);
  assert.equal((await A('PUT', '/api/tests/t1', { date: TODAY, test: '5km', valeur: 1785 })).status, 200);
  assert.equal((await A('PUT', '/api/tests/t2', { date: TODAY, test: 'marathon', valeur: 1 })).status, 400);
  assert.equal((await A('GET', '/api/tests')).body.tests[0].valeur, 1785);
});

test('programmes : enregistrement, semaine passée archivée, statistiques SQL', async () => {
  assert.equal((await A('PUT', `/api/plans/training/2026-11-10`, plan('2026-11-10'))).status, 400, 'une semaine commence un lundi');
  assert.equal((await A('PUT', `/api/plans/training/${WEEK}`, plan('2026-11-02'))).status, 400, 'semaine incohérente');
  assert.equal((await A('PUT', `/api/plans/training/${WEEK}`, { ...plan(WEEK), days: [] })).status, 400);
  assert.equal((await A('PUT', '/api/plans/training/2026-11-02', plan('2026-11-02'))).status, 200);
  assert.equal((await A('PUT', `/api/plans/training/${WEEK}`, plan(WEEK))).status, 200);
  await A('PUT', '/api/sessions/2026-11-03', { date: '2026-11-03', type: 'renfo', titre: 'Renfo', dureeMin: 30, rpe: 7 });
  const b = (await A('GET', `/api/bootstrap?week=${WEEK}`)).body;
  assert.equal(b.training.weekKey, WEEK);
  assert.equal(b.profile.prenom, 'Alex');
  assert.deepEqual(Object.keys(b.sessions).sort(), ['2026-11-03', TODAY]);
  assert.equal(b.weeks['2026-11-02'].prevues, 3);
  assert.equal(b.weights['2026-11-12'].kg, 81.4);
  assert.equal(b.ai, true);
  const next = (await A('GET', '/api/bootstrap?week=2026-11-16')).body;
  assert.equal(next.training.weekKey, WEEK, 'nouvelle semaine : le dernier programme connu est renvoyé');
  const st = (await A('GET', `/api/stats/weekly?week=${WEEK}&weeks=3`)).body.weeks;
  assert.deepEqual(st.map((w: any) => w.week), ['2026-10-26', '2026-11-02', WEEK]);
  assert.deepEqual(st[1], { week: '2026-11-02', course: 0, renfo: 30, autre: 0, km: 0, faites: 1, rpeMoyen: 7, prevues: 3, poidsMoyen: null });
  assert.equal(st[2].course, 45); assert.equal(st[2].km, 5.2); assert.equal(st[2].faites, 1); assert.equal(st[2].poidsMoyen, 81.4);
  assert.equal(st[0].prevues, null);
});

test('cloisonnement : un utilisateur ne voit ni ne modifie les données d\'un autre', async () => {
  const b = (await B('GET', `/api/bootstrap?week=${WEEK}`)).body;
  assert.equal(b.profile, null);
  assert.deepEqual(b.sessions, {});
  assert.deepEqual(b.weights, {});
  assert.equal((await B('DELETE', `/api/sessions/${TODAY}`)).status, 200);
  assert.equal((await B('PUT', `/api/sessions/${TODAY}`, { date: TODAY, type: 'renfo', dureeMin: 10 })).status, 200, 'même identifiant, autre utilisateur');
  const a = (await A('GET', '/api/sessions')).body.sessions.find((s: any) => s.id === TODAY);
  assert.equal(a.type, 'course');
  assert.equal(a.dureeMin, 45);
});

test('état d\'interface : borné en taille', async () => {
  assert.equal((await A('PUT', '/api/state', { v: 2, checks: { [TODAY]: [0, 1] } })).status, 200);
  assert.deepEqual((await A('GET', `/api/bootstrap?week=${WEEK}`)).body.state.checks[TODAY], [0, 1]);
  assert.equal((await A('PUT', '/api/state', { gros: 'x'.repeat(200_000) })).status, 400);
});

test('génération par Claude : désactivée sans clé, sinon enregistrée en base', async () => {
  const N = client(() => appNoAi);
  await N('POST', '/api/auth/login', { email: 'a@example.com', password: 'motdepasse1' });
  const off = await N('POST', '/api/ai/training', { week: WEEK });
  assert.equal(off.status, 503);
  assert.equal(off.body.error.code, 'ai_disabled');
  assert.equal((await N('GET', `/api/bootstrap?week=${WEEK}`)).body.ai, false);
  assert.equal((await B('POST', '/api/ai/training', { week: WEEK })).body.error.code, 'no_profile');

  const t = await A('POST', '/api/ai/training', { week: WEEK, today: TODAY });
  assert.equal(t.status, 200);
  assert.equal(t.body.plan.source, 'claude');
  assert.equal(t.body.plan.days.length, 7);
  assert.equal(t.body.plan.days[1].type, 'repos', 'jours absents de la réponse complétés en repos');
  assert.equal(t.body.plan.semaine, 3);
  assert.match(prompts.at(-1)!, /Footing \(course\) : 45 min, 5\.2 km à 8:39\/km, effort 6\/10, ressenti trop dur/, 'l\'historique réel est transmis au modèle');
  assert.match(prompts.at(-1)!, /semaine du 2026-11-02 : 1\/3 séances/);
  assert.equal((await A('GET', `/api/plans/training/${WEEK}`)).body.plan.source, 'claude');

  const m = await A('POST', '/api/ai/meals', { week: WEEK });
  assert.equal(m.body.plan.jours.length, 7);
  assert.equal(m.body.plan.cibles.prot, 148);
  const sw = await A('POST', '/api/ai/swap-meal', { week: WEEK, day: 2, index: 0 });
  assert.equal(sw.body.plan.jours[2].repas[0].nom, 'Saumon et quinoa');
  assert.equal(sw.body.plan.jours[3].repas[0].nom, 'Poulet et riz');
  assert.equal((await A('POST', '/api/ai/swap-meal', { week: WEEK, day: 2, index: 5 })).status, 404);
  const ad = await A('POST', '/api/ai/adapt', { session: t.body.plan.days[0], checkin: { energie: 2, temps: 30, courbatures: true } });
  assert.equal(ad.body.session.titre, 'Footing allégé');
  assert.equal(ad.body.session.adaptee, true);
  assert.equal((await A('POST', '/api/ai/review', { week: WEEK, today: TODAY })).body.text, 'Tu progresses bien.');
  aiMode = 'refuse';
  const ref = await A('POST', '/api/ai/training', { week: WEEK });
  assert.equal(ref.status, 422);
  assert.equal(ref.body.error.code, 'ai_refused');
  aiMode = 'ok';
  assert.equal((await A('GET', `/api/plans/training/${WEEK}`)).body.plan.source, 'claude', 'un échec ne casse pas le programme existant');
});

test('les schémas de sortie se convertissent en format structuré pour l\'API Anthropic', () => {
  for (const s of [coach.TrainingOut, coach.MealsOut, coach.MealOut, coach.SessionOut]) {
    const f: any = betaZodOutputFormat(s as z.ZodType);
    assert.equal(f.type, 'json_schema');
    assert.equal(f.schema.type, 'object');
  }
});

test('export, effacement des données, suppression du compte', async () => {
  const ex = await A('GET', '/api/export');
  assert.equal(ex.status, 200);
  assert.match(String(ex.raw.headers['content-disposition']), /attachment/);
  assert.equal(ex.body.seances.length, 2);
  assert.equal(ex.body.programmes.length, 3);
  assert.equal((await A('DELETE', '/api/data')).status, 200);
  const b = (await A('GET', `/api/bootstrap?week=${WEEK}`)).body;
  assert.equal(b.profile, null); assert.deepEqual(b.sessions, {}); assert.equal(b.training, null);
  assert.equal((await A('GET', '/api/auth/me')).status, 200, 'le compte est conservé');
  assert.equal((await B('GET', '/api/sessions')).body.sessions.length, 1, 'les données des autres sont intactes');
  assert.equal((await B('DELETE', '/api/account', { password: 'faux' })).status, 401);
  assert.equal((await B('DELETE', '/api/account', { password: 'motdepasse2' })).status, 200);
  assert.equal((await B('GET', '/api/auth/me')).status, 401);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM workouts`)).rows[0]!.n, 0, 'suppression en cascade');
  assert.equal((await B('POST', '/api/auth/login', { email: 'b@example.com', password: 'motdepasse2' })).status, 401);
});

test('en-têtes de sécurité, pages et routes inconnues', async () => {
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.equal(home.statusCode, 200);
  assert.match(String(home.headers['content-security-policy']), /script-src 'self'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).json().ok, true);
});
