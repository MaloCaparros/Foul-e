import { z } from 'zod';

/** Date civile AAAA-MM-JJ, réellement existante. */
export const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue au format AAAA-MM-JJ')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'date inexistante');
/** Lundi d'une semaine. */
export const WeekStr = DateStr.refine((s) => new Date(s + 'T00:00:00Z').getUTCDay() === 1, 'la semaine doit commencer un lundi');
export const IdStr = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'identifiant invalide');
const text = (max: number) => z.string().trim().max(max);

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('adresse e-mail invalide')),
  password: z.string().min(8, 'mot de passe : 8 caractères minimum').max(200),
});

export const Profile = z.object({
  prenom: text(60).default(''),
  sexe: z.enum(['h', 'f']),
  age: z.number().int().min(14).max(90),
  taille: z.number().min(120).max(220),
  poids: z.number().min(30).max(250),
  poidsCible: z.number().min(0).max(250).default(0),
  principal: z.enum(['course', 'poids', 'muscle']),
  limitations: text(300).default(''),
  niveau: z.enum(['debutant', 'intermediaire', 'confirme']),
  chrono5k: text(10).default(''),
  duree: z.number().int().min(15).max(180),
  jours: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  materiel: z.array(z.enum(['aucun', 'halteres', 'elastiques', 'traction', 'salle'])).min(1).max(5),
  aime: text(600).default(''),
  deteste: text(600).default(''),
  regime: z.enum(['omnivore', 'sansporc', 'pescetarien', 'vegetarien', 'vegan']),
  allergies: text(300).default(''),
  cuisine: z.enum(['rapide', 'moyen', 'plaisir']),
  collation: z.boolean(),
  debut: DateStr,
});
export type Profile = z.infer<typeof Profile>;

export const SESSION_TYPES = ['course', 'renfo', 'mixte', 'mobilite', 'repos'] as const;
export const PlanSession = z.object({
  day: z.number().int().min(0).max(6),
  type: z.enum(SESSION_TYPES),
  titre: text(120),
  duree: z.number().min(0).max(600).default(0),
  intensite: z.enum(['facile', 'moderee', 'intense']).default('facile'),
  echauffement: text(600).default(''),
  blocs: z.array(z.object({ nom: text(200), detail: text(600).default('') })).max(30).default([]),
  retour: text(600).default(''),
  conseil: text(800).default(''),
  adaptee: z.boolean().optional(),
});
export type PlanSession = z.infer<typeof PlanSession>;

export const TrainingPlan = z.object({
  weekKey: WeekStr,
  source: z.enum(['local', 'claude']),
  semaine: z.number().int().min(0).max(5000).default(0),
  focus: text(300).default(''),
  days: z.array(PlanSession).length(7),
  prevWeek: WeekStr.optional(),
});
export type TrainingPlan = z.infer<typeof TrainingPlan>;

export const Meal = z.object({
  moment: text(40),
  nom: text(200),
  ingredients: z.array(text(160)).max(40).default([]),
  kcal: z.number().min(0).max(5000).default(0),
  prot: z.number().min(0).max(500).default(0),
  temps: z.number().min(0).max(600).default(0),
});
export const MealPlan = z.object({
  weekKey: WeekStr,
  source: z.enum(['local', 'claude']),
  cibles: z.object({ kcal: z.number().min(0).max(10000), prot: z.number().min(0).max(600) }),
  jours: z.array(z.object({ day: z.number().int().min(0).max(6), repas: z.array(Meal).max(8) })).length(7),
  courses: z.array(z.object({ rayon: text(80), items: z.array(text(200)).max(120) })).max(30).default([]),
  astuces: text(1500).default(''),
});
export type MealPlan = z.infer<typeof MealPlan>;

/** État d'interface : document libre mais borné en taille. */
export const UserState = z
  .record(z.string().max(40), z.unknown())
  .refine((o) => JSON.stringify(o).length <= 100_000, 'état trop volumineux');

export const Workout = z.object({
  date: DateStr,
  type: z.enum(['course', 'renfo', 'mixte', 'mobilite', 'autre']),
  titre: text(120).default(''),
  prevue: z.boolean().default(false),
  dureeMin: z.number().int().min(0).max(600),
  distanceKm: z.number().min(0).max(300).default(0),
  rpe: z.number().int().min(0).max(10).default(0),
  ressenti: z.enum(['facile', 'ok', 'dur']).default('ok'),
  note: text(500).default(''),
});
export const Weight = z.object({ kg: z.number().min(30).max(250) });
const cm = z.number().min(40).max(200).optional();
export const Measure = z
  .object({ taille: cm, hanches: cm, poitrine: cm })
  .refine((m) => m.taille != null || m.hanches != null || m.poitrine != null, 'au moins une mesure est requise');
export const TESTS = ['5km', '10km', '1km', 'pompes', 'gainage', 'squats', 'tractions'] as const;
export const PerfTest = z.object({ date: DateStr, test: z.enum(TESTS), valeur: z.number().int().min(1).max(100000) });

export const CheckIn = z.object({
  energie: z.number().int().min(1).max(5),
  temps: z.number().int().min(0).max(240).default(0),
  courbatures: z.boolean().default(false),
});
