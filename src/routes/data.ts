import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db, Queryable, Row } from '../db.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { DateStr, IdStr, MealPlan, Measure, PerfTest, Profile, TrainingPlan, UserState, WeekStr, Weight, Workout } from '../schemas.js';

/* ---------- lecture : lignes SQL -> objets de l'API ---------- */
const D = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
const WORKOUT_COLS = `id, ${D('date')} AS date, ${D(`date_trunc('week', date)`)} AS "weekKey", type, title AS titre, planned AS prevue,
  duration_min AS "dureeMin", distance_km::float8 AS "distanceKm", pace_sec AS "allureSec", rpe::int AS rpe, feeling AS ressenti, note`;
const stripNulls = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as T;
const byId = (rows: Row[]) => Object.fromEntries(rows.map(({ id, ...rest }) => [id as string, rest]));
const byDate = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.date as string, r]));

export const repo = {
  async profile(q: Queryable, uid: string): Promise<Profile | null> {
    return (await q.query(`SELECT data FROM profiles WHERE user_id = $1`, [uid])).rows[0]?.data ?? null;
  },
  async plan(q: Queryable, uid: string, kind: 'training' | 'meals', week: string) {
    return (await q.query(`SELECT data FROM plans WHERE user_id = $1 AND kind = $2 AND week_start = $3`, [uid, kind, week])).rows[0]?.data ?? null;
  },
  /** Dernier programme enregistré jusqu'à `week` incluse (sert à détecter le passage à une nouvelle semaine). */
  async latestPlan(q: Queryable, uid: string, kind: 'training' | 'meals', week: string) {
    return (await q.query(`SELECT data FROM plans WHERE user_id = $1 AND kind = $2 AND week_start <= $3 ORDER BY week_start DESC LIMIT 1`, [uid, kind, week])).rows[0]?.data ?? null;
  },
  async savePlan(q: Queryable, uid: string, kind: 'training' | 'meals', plan: { weekKey: string; source: string }) {
    await q.query(
      `INSERT INTO plans (user_id, kind, week_start, source, data) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (user_id, kind, week_start) DO UPDATE SET source = EXCLUDED.source, data = EXCLUDED.data, updated_at = now()`,
      [uid, kind, plan.weekKey, plan.source, JSON.stringify(plan)],
    );
  },
  async workouts(q: Queryable, uid: string, from = '0001-01-01', to = '9999-12-31', limit = 1000) {
    return (await q.query(`SELECT ${WORKOUT_COLS} FROM workouts WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date DESC, id LIMIT $4`, [uid, from, to, limit])).rows;
  },
  async weights(q: Queryable, uid: string) {
    return (await q.query(`SELECT ${D('date')} AS date, kg::float8 AS kg FROM weights WHERE user_id = $1 ORDER BY date DESC LIMIT 2000`, [uid])).rows;
  },
  async measures(q: Queryable, uid: string) {
    const { rows } = await q.query(`SELECT ${D('date')} AS date, waist_cm::float8 AS taille, hips_cm::float8 AS hanches, chest_cm::float8 AS poitrine FROM measures WHERE user_id = $1 ORDER BY date DESC LIMIT 2000`, [uid]);
    return rows.map(stripNulls);
  },
  async tests(q: Queryable, uid: string) {
    return (await q.query(`SELECT id, ${D('date')} AS date, test, value AS valeur FROM tests WHERE user_id = $1 ORDER BY date DESC, id LIMIT 2000`, [uid])).rows;
  },
  /** Semaines passées : résumé de chaque programme archivé. */
  async pastWeeks(q: Queryable, uid: string, before: string) {
    const { rows } = await q.query(`SELECT ${D('week_start')} AS week, source, data FROM plans WHERE user_id = $1 AND kind = 'training' AND week_start < $2 ORDER BY week_start DESC LIMIT 104`, [uid, before]);
    return rows.map((r) => {
      const days = (r.data?.days ?? []) as { day: number; type: string; titre: string; duree: number }[];
      return { date: r.week, weekKey: r.week, semaine: r.data?.semaine ?? 0, focus: r.data?.focus ?? '', source: r.source,
        prevues: days.filter((d) => d.type !== 'repos').length, days: days.map((d) => ({ day: d.day, type: d.type, titre: d.titre, duree: d.duree ?? 0 })) };
    });
  },
  /** Agrégats hebdomadaires calculés en SQL, de la plus ancienne semaine à `week`. */
  async weeklyStats(q: Queryable, uid: string, week: string, weeks: number) {
    const { rows } = await q.query(
      `WITH w AS (SELECT generate_series($2::date - ($3::int - 1) * 7, $2::date, interval '7 days')::date AS week_start)
       SELECT ${D('w.week_start')} AS week,
         COALESCE(SUM(s.duration_min) FILTER (WHERE s.type IN ('course', 'mixte')), 0)::int AS course,
         COALESCE(SUM(s.duration_min) FILTER (WHERE s.type = 'renfo'), 0)::int AS renfo,
         COALESCE(SUM(s.duration_min) FILTER (WHERE s.type NOT IN ('course', 'mixte', 'renfo')), 0)::int AS autre,
         COALESCE(SUM(s.distance_km) FILTER (WHERE s.type IN ('course', 'mixte')), 0)::float8 AS km,
         COUNT(s.id)::int AS faites,
         ROUND(AVG(NULLIF(s.rpe, 0)), 1)::float8 AS "rpeMoyen",
         (SELECT (SELECT COUNT(*) FROM jsonb_array_elements(p.data -> 'days') d WHERE d ->> 'type' <> 'repos')::int
            FROM plans p WHERE p.user_id = $1 AND p.kind = 'training' AND p.week_start = w.week_start) AS prevues,
         (SELECT ROUND(AVG(kg), 1)::float8 FROM weights x WHERE x.user_id = $1 AND x.date >= w.week_start AND x.date < w.week_start + 7) AS "poidsMoyen"
       FROM w LEFT JOIN workouts s ON s.user_id = $1 AND s.date >= w.week_start AND s.date < w.week_start + 7
       GROUP BY w.week_start ORDER BY w.week_start`,
      [uid, week, weeks],
    );
    return rows as { week: string; course: number; renfo: number; autre: number; km: number; faites: number; rpeMoyen: number | null; prevues: number | null; poidsMoyen: number | null }[];
  },
};

const WeekQuery = z.object({ week: WeekStr });
const KindParam = z.object({ kind: z.enum(['training', 'meals']), week: WeekStr });

export function registerData(app: FastifyInstance, db: Db, opts: { aiEnabled: boolean }) {
  /* Tout ce qu'il faut à l'ouverture de l'application, en un aller-retour. */
  app.get('/api/bootstrap', async (req) => {
    const user = requireUser(req);
    const { week } = WeekQuery.parse(req.query);
    const [profile, training, meals, state, sessions, weights, measures, tests, weeks] = await Promise.all([
      repo.profile(db, user.id),
      repo.latestPlan(db, user.id, 'training', week),
      repo.latestPlan(db, user.id, 'meals', week),
      db.query(`SELECT data FROM user_state WHERE user_id = $1`, [user.id]).then((r) => r.rows[0]?.data ?? null),
      repo.workouts(db, user.id),
      repo.weights(db, user.id),
      repo.measures(db, user.id),
      repo.tests(db, user.id),
      repo.pastWeeks(db, user.id, week),
    ]);
    return { user, ai: opts.aiEnabled, profile, training, meals, state,
      sessions: byId(sessions), weights: byDate(weights), measures: byDate(measures), tests: byId(tests), weeks: Object.fromEntries(weeks.map((w) => [w.weekKey, w])) };
  });

  /* ---------- profil ---------- */
  app.get('/api/profile', async (req) => ({ profile: await repo.profile(db, requireUser(req).id) }));
  app.put('/api/profile', async (req) => {
    const user = requireUser(req);
    const profile = Profile.parse(req.body);
    profile.jours = [...new Set(profile.jours)].sort((a, b) => a - b);
    await db.query(`INSERT INTO profiles (user_id, data) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [user.id, JSON.stringify(profile)]);
    return { profile };
  });

  /* ---------- programmes et menus hebdomadaires ---------- */
  app.get('/api/plans/:kind/:week', async (req) => {
    const user = requireUser(req);
    const { kind, week } = KindParam.parse(req.params);
    const plan = await repo.plan(db, user.id, kind, week);
    if (!plan) throw new HttpError(404, 'not_found', 'Aucun programme pour cette semaine.');
    return { plan };
  });
  app.put('/api/plans/:kind/:week', async (req) => {
    const user = requireUser(req);
    const { kind, week } = KindParam.parse(req.params);
    const plan = (kind === 'training' ? TrainingPlan : MealPlan).parse(req.body);
    if (plan.weekKey !== week) throw new HttpError(400, 'week_mismatch', 'La semaine du programme ne correspond pas à l\'adresse.');
    await repo.savePlan(db, user.id, kind, plan);
    return { plan };
  });
  app.get('/api/weeks', async (req) => ({ weeks: await repo.pastWeeks(db, requireUser(req).id, WeekQuery.parse(req.query).week) }));

  /* ---------- état d'interface ---------- */
  app.put('/api/state', async (req) => {
    const user = requireUser(req);
    const state = UserState.parse(req.body);
    await db.query(`INSERT INTO user_state (user_id, data) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [user.id, JSON.stringify(state)]);
    return { ok: true };
  });

  /* ---------- séances réalisées ---------- */
  app.get('/api/sessions', async (req) => {
    const user = requireUser(req);
    const { from, to } = z.object({ from: DateStr.optional(), to: DateStr.optional() }).parse(req.query);
    return { sessions: await repo.workouts(db, user.id, from, to) };
  });
  app.put('/api/sessions/:id', async (req) => {
    const user = requireUser(req);
    const id = IdStr.parse((req.params as any).id);
    const w = Workout.parse(req.body);
    // L'allure est toujours recalculée ici, jamais reprise du client.
    const pace = w.type === 'course' && w.distanceKm > 0 && w.dureeMin > 0 ? Math.round((w.dureeMin * 60) / w.distanceKm) : 0;
    const { rows } = await db.query(
      `INSERT INTO workouts (user_id, id, date, type, title, planned, duration_min, distance_km, pace_sec, rpe, feeling, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id, id) DO UPDATE SET date = EXCLUDED.date, type = EXCLUDED.type, title = EXCLUDED.title, planned = EXCLUDED.planned,
         duration_min = EXCLUDED.duration_min, distance_km = EXCLUDED.distance_km, pace_sec = EXCLUDED.pace_sec, rpe = EXCLUDED.rpe,
         feeling = EXCLUDED.feeling, note = EXCLUDED.note, updated_at = now()
       RETURNING ${WORKOUT_COLS}`,
      [user.id, id, w.date, w.type, w.titre, w.prevue, w.dureeMin, w.distanceKm, pace, w.rpe, w.ressenti, w.note],
    );
    return { session: rows[0] };
  });
  app.delete('/api/sessions/:id', async (req) => {
    const user = requireUser(req);
    await db.query(`DELETE FROM workouts WHERE user_id = $1 AND id = $2`, [user.id, IdStr.parse((req.params as any).id)]);
    return { ok: true };
  });

  /* ---------- pesées ---------- */
  app.get('/api/weights', async (req) => ({ weights: await repo.weights(db, requireUser(req).id) }));
  app.put('/api/weights/:date', async (req) => {
    const user = requireUser(req);
    const date = DateStr.parse((req.params as any).date);
    const { kg } = Weight.parse(req.body);
    await db.query(`INSERT INTO weights (user_id, date, kg) VALUES ($1, $2, $3) ON CONFLICT (user_id, date) DO UPDATE SET kg = EXCLUDED.kg, updated_at = now()`, [user.id, date, kg]);
    return { weight: { date, kg: Math.round(kg * 10) / 10 } };
  });
  app.delete('/api/weights/:date', async (req) => {
    await db.query(`DELETE FROM weights WHERE user_id = $1 AND date = $2`, [requireUser(req).id, DateStr.parse((req.params as any).date)]);
    return { ok: true };
  });

  /* ---------- mensurations ---------- */
  app.get('/api/measures', async (req) => ({ measures: await repo.measures(db, requireUser(req).id) }));
  app.put('/api/measures/:date', async (req) => {
    const user = requireUser(req);
    const date = DateStr.parse((req.params as any).date);
    const m = Measure.parse(req.body);
    await db.query(
      `INSERT INTO measures (user_id, date, waist_cm, hips_cm, chest_cm) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date) DO UPDATE SET waist_cm = EXCLUDED.waist_cm, hips_cm = EXCLUDED.hips_cm, chest_cm = EXCLUDED.chest_cm, updated_at = now()`,
      [user.id, date, m.taille ?? null, m.hanches ?? null, m.poitrine ?? null],
    );
    return { measure: { date, ...m } };
  });
  app.delete('/api/measures/:date', async (req) => {
    await db.query(`DELETE FROM measures WHERE user_id = $1 AND date = $2`, [requireUser(req).id, DateStr.parse((req.params as any).date)]);
    return { ok: true };
  });

  /* ---------- tests de performance ---------- */
  app.get('/api/tests', async (req) => ({ tests: await repo.tests(db, requireUser(req).id) }));
  app.put('/api/tests/:id', async (req) => {
    const user = requireUser(req);
    const id = IdStr.parse((req.params as any).id);
    const t = PerfTest.parse(req.body);
    await db.query(
      `INSERT INTO tests (user_id, id, date, test, value) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO UPDATE SET date = EXCLUDED.date, test = EXCLUDED.test, value = EXCLUDED.value`,
      [user.id, id, t.date, t.test, t.valeur],
    );
    return { test: { id, ...t } };
  });
  app.delete('/api/tests/:id', async (req) => {
    await db.query(`DELETE FROM tests WHERE user_id = $1 AND id = $2`, [requireUser(req).id, IdStr.parse((req.params as any).id)]);
    return { ok: true };
  });

  /* ---------- statistiques ---------- */
  app.get('/api/stats/weekly', async (req) => {
    const user = requireUser(req);
    const { week, weeks } = z.object({ week: WeekStr, weeks: z.coerce.number().int().min(1).max(104).default(12) }).parse(req.query);
    return { weeks: await repo.weeklyStats(db, user.id, week, weeks) };
  });

  /* ---------- export et effacement ---------- */
  app.get('/api/export', async (req, reply) => {
    const user = requireUser(req);
    const [profile, plans, sessions, weights, measures, tests] = await Promise.all([
      repo.profile(db, user.id),
      db.query(`SELECT kind, ${D('week_start')} AS week, source, data FROM plans WHERE user_id = $1 ORDER BY week_start, kind`, [user.id]).then((r) => r.rows),
      repo.workouts(db, user.id, undefined, undefined, 100000),
      repo.weights(db, user.id),
      repo.measures(db, user.id),
      repo.tests(db, user.id),
    ]);
    reply.header('content-disposition', `attachment; filename="foulee-donnees-${new Date().toISOString().slice(0, 10)}.json"`);
    return { exporte_le: new Date().toISOString(), compte: user.email, profil: profile, programmes: plans, seances: sessions, pesees: weights, mesures: measures, tests };
  });
  /** Efface toutes les données de suivi en conservant le compte. */
  app.delete('/api/data', async (req) => {
    const user = requireUser(req);
    await db.tx(async (q) => {
      for (const t of ['profiles', 'plans', 'user_state', 'workouts', 'weights', 'measures', 'tests']) await q.query(`DELETE FROM ${t} WHERE user_id = $1`, [user.id]);
    });
    return { ok: true };
  });
}
