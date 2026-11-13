import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { AiError, type AiClient } from '../coach/ai.js';
import * as coach from '../coach/prompts.js';
import { CheckIn, DateStr, MealPlan, PlanSession, TrainingPlan, WeekStr, type Profile } from '../schemas.js';
import { repo } from './data.js';

const TEST_LABEL: Record<string, string> = { '5km': '5 km', '10km': '10 km', '1km': '1 km', pompes: 'pompes max', gainage: 'gainage', squats: 'squats en 1 min', tractions: 'tractions max' };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const shift = (d: string, days: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + days * 864e5).toISOString().slice(0, 10);

/** Résumé de l'historique réel, lu en base, fourni au modèle. */
export async function historyText(db: Db, uid: string, week: string, today: string): Promise<string> {
  const [sessions, stats, weights, measures, tests] = await Promise.all([
    repo.workouts(db, uid, shift(today, -21), today, 60),
    repo.weeklyStats(db, uid, shift(week, -7), 4),
    repo.weights(db, uid),
    repo.measures(db, uid),
    repo.tests(db, uid),
  ]);
  const RES: Record<string, string> = { facile: 'trop facile', ok: 'juste bien', dur: 'trop dur' };
  const lines = [...sessions].reverse().map((s) =>
    `${s.date} · ${s.titre || s.type} (${s.type}) : ${s.dureeMin || '?'} min${s.distanceKm ? `, ${s.distanceKm} km${s.allureSec ? ` à ${clock(s.allureSec)}/km` : ''}` : ''}${s.rpe ? `, effort ${s.rpe}/10` : ''}, ressenti ${RES[s.ressenti]}${s.note ? ` — « ${s.note} »` : ''}`);
  const wk = stats.map((w) => `semaine du ${w.week} : ${w.faites}${w.prevues != null ? '/' + w.prevues : ''} séances, ${w.course + w.renfo + w.autre} min, ${w.km} km courus${w.poidsMoyen ? `, poids moyen ${w.poidsMoyen} kg` : ''}`);
  const parts = [
    lines.length ? 'Séances réalisées (3 dernières semaines) :\n' + lines.join('\n') : "Aucune séance enregistrée pour l'instant.",
    'Bilan par semaine :\n' + wk.join('\n'),
    weights.length ? 'Pesées : ' + weights.slice(0, 6).reverse().map((x) => `${x.date} ${x.kg} kg`).join(' ; ') : '',
    measures.length ? 'Tour de taille : ' + measures.filter((m) => m.taille).slice(0, 3).reverse().map((m) => `${m.date} ${m.taille} cm`).join(' ; ') : '',
    tests.length ? 'Tests : ' + tests.slice(0, 6).reverse().map((t) => `${t.date} ${TEST_LABEL[t.test] ?? t.test} : ${['5km', '10km', '1km', 'gainage'].includes(t.test) ? clock(t.valeur) : t.valeur + ' rép.'}`).join(' ; ') : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

const AI_STATUS: Record<AiError['code'], number> = { refused: 422, truncated: 502, invalid: 502, rate_limited: 429, auth: 503, upstream: 502 };

export function registerAi(app: FastifyInstance, db: Db, ai: AiClient | null) {
  // Les appels au modèle coûtent : plafond par utilisateur.
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: (req: FastifyRequest) => 'ai:' + (req.user?.id ?? req.ip) } } };
  const Base = z.object({ week: WeekStr, today: DateStr.optional() });

  async function context(req: FastifyRequest): Promise<{ uid: string; profile: Profile; ai: AiClient }> {
    const user = requireUser(req);
    if (!ai) throw new HttpError(503, 'ai_disabled', "La génération par Claude n'est pas activée sur ce serveur.");
    const profile = await repo.profile(db, user.id);
    if (!profile) throw new HttpError(400, 'no_profile', "Crée d'abord ton profil.");
    return { uid: user.id, profile, ai };
  }
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(AI_STATUS[e.code], 'ai_' + e.code, e.message);
      if (e instanceof Error && ['programme vide', 'menus incomplets'].includes(e.message)) throw new HttpError(502, 'ai_invalid', 'La réponse du modèle était incomplète.');
      throw e;
    }
  };

  app.post('/api/ai/training', limit, async (req) => {
    const { uid, profile, ai } = await context(req);
    const { week, today } = Base.parse(req.body);
    const history = await historyText(db, uid, week, today ?? new Date().toISOString().slice(0, 10));
    const plan = await guard(async () => TrainingPlan.parse(coach.normTraining(await ai.json(coach.trainingPrompt(profile, week, history), coach.TrainingOut), profile, week)));
    await repo.savePlan(db, uid, 'training', plan);
    return { plan };
  });

  app.post('/api/ai/meals', limit, async (req) => {
    const { uid, profile, ai } = await context(req);
    const { week } = Base.parse(req.body);
    const training = await repo.plan(db, uid, 'training', week);
    const plan = await guard(async () => MealPlan.parse(coach.normMeals(await ai.json(coach.mealsPrompt(profile, week, training), coach.MealsOut), profile, week)));
    await repo.savePlan(db, uid, 'meals', plan);
    return { plan };
  });

  app.post('/api/ai/swap-meal', limit, async (req) => {
    const { uid, profile, ai } = await context(req);
    const { week, day, index } = Base.extend({ day: z.number().int().min(0).max(6), index: z.number().int().min(0).max(7) }).parse(req.body);
    const plan = MealPlan.parse(await repo.plan(db, uid, 'meals', week) ?? (() => { throw new HttpError(404, 'not_found', 'Aucun menu pour cette semaine.'); })());
    const current = plan.jours[day]?.repas[index];
    if (!current) throw new HttpError(404, 'not_found', 'Ce repas n\'existe pas.');
    const meal = await guard(async () => coach.normSwap(await ai.json(coach.swapPrompt(profile, plan, day, index), coach.MealOut, 'low'), current.moment));
    if (!meal.nom) throw new HttpError(502, 'ai_invalid', 'La réponse du modèle était incomplète.');
    plan.jours[day]!.repas[index] = meal;
    await repo.savePlan(db, uid, 'meals', plan);
    return { plan };
  });

  // Adaptation de la séance du jour : renvoyée au client, qui la garde dans son état du jour.
  app.post('/api/ai/adapt', limit, async (req) => {
    const { profile, ai } = await context(req);
    const { session, checkin } = z.object({ session: PlanSession, checkin: CheckIn }).parse(req.body);
    const out = await guard(async () => coach.normSession(await ai.json(coach.adaptPrompt(profile, session, checkin), coach.SessionOut, 'low'), session.day));
    return { session: { ...out, adaptee: true } };
  });

  app.post('/api/ai/review', limit, async (req) => {
    const { uid, profile, ai } = await context(req);
    const { week, today } = Base.parse(req.body);
    const history = await historyText(db, uid, week, today ?? new Date().toISOString().slice(0, 10));
    const text = await guard(() => ai.text(coach.reviewPrompt(profile, history)));
    return { text: text.trim().slice(0, 4000) };
  });
}
