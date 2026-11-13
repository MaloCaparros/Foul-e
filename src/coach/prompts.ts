import { z } from 'zod';
import type { MealPlan, PlanSession, Profile, TrainingPlan } from '../schemas.js';
import { SESSION_TYPES } from '../schemas.js';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DSHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const utc = (d: string) => new Date(d + 'T12:00:00Z');
const frDate = (d: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) => utc(d).toLocaleDateString('fr-FR', { ...o, timeZone: 'UTC' });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** Lundi de la semaine contenant `d`. */
export function mondayOf(d: string): string {
  const x = utc(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
export const weekIndex = (p: Profile, week: string) => Math.max(1, Math.round((utc(week).getTime() - utc(mondayOf(p.debut)).getTime()) / (7 * 864e5)) + 1);

/** Besoins quotidiens : Mifflin-St Jeor, facteur d'activité selon le nombre de séances, déficit modéré si perte de poids. */
export function targets(p: Profile) {
  const bmr = 10 * p.poids + 6.25 * p.taille - 5 * p.age + (p.sexe === 'f' ? -161 : 5);
  const tdee = bmr * clamp(1.35 + 0.05 * (p.jours.length - 3), 1.3, 1.6);
  const lose = p.poidsCible > 0 && p.poidsCible < p.poids - 0.5;
  let kcal = lose ? Math.max(tdee * 0.82, bmr * 1.1, p.sexe === 'f' ? 1300 : 1600) : p.principal === 'muscle' ? tdee * 1.03 : tdee;
  kcal = Math.round(kcal / 50) * 50;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee / 10) * 10, kcal, prot: Math.round(p.poids * (p.principal === 'muscle' ? 2 : 1.8)), lose };
}

export function profileText(p: Profile): string {
  const t = targets(p);
  return JSON.stringify({
    prenom: p.prenom || undefined, sexe: p.sexe === 'f' ? 'femme' : 'homme', age: p.age, taille_cm: p.taille, poids_kg: p.poids, poids_cible_kg: p.poidsCible || undefined,
    niveau_course: p.niveau, chrono_5km: p.chrono5k || 'inconnu', jours_disponibles: p.jours.map((i) => DAYS[i]), duree_max_seance_min: p.duree, materiel: p.materiel,
    objectif_prioritaire: { course: 'progresser en course à pied', poids: 'perdre du poids', muscle: "se muscler et s'affiner" }[p.principal],
    aime: p.aime, n_aime_pas: p.deteste, regime: p.regime, allergies: p.allergies || 'aucune', temps_cuisine: p.cuisine, collation: p.collation, limitations_blessures: p.limitations || 'aucune',
    cibles: { kcal_jour: t.kcal, proteines_g: t.prot, depense_estimee: t.tdee },
  }, null, 1);
}

/* ---------- formes attendues en sortie du modèle ---------- */
const SessionOut = z.object({
  type: z.enum(SESSION_TYPES), titre: z.string(), duree: z.number(), intensite: z.enum(['facile', 'moderee', 'intense']),
  echauffement: z.string(), blocs: z.array(z.object({ nom: z.string(), detail: z.string() })), retour: z.string(), conseil: z.string(),
});
export const TrainingOut = z.object({ focus: z.string(), jours: z.array(SessionOut.extend({ jour: z.number() })) });
const MealOut = z.object({ moment: z.string(), nom: z.string(), ingredients: z.array(z.string()), kcal: z.number(), prot: z.number(), temps: z.number() });
export const MealsOut = z.object({
  jours: z.array(z.object({ jour: z.number(), repas: z.array(MealOut) })),
  courses: z.array(z.object({ rayon: z.string(), items: z.array(z.string()) })),
  astuces: z.string(),
});
export { SessionOut, MealOut };

/* ---------- consignes ---------- */
export function trainingPrompt(p: Profile, week: string, history: string): string {
  return `Tu es un coach diplômé en course à pied et préparation physique. Prépare le programme d'entraînement de la semaine du ${frDate(week)} (semaine n°${weekIndex(p, week)} depuis le début du suivi) pour cette personne.

PROFIL :
${profileText(p)}

RÉSULTATS RÉCENTS (journal d'entraînement, pesées, tests) :
${history}

RÈGLES :
- Séances uniquement les jours disponibles. Les autres jours : type "repos" (avec un conseil de récupération ou de pas quotidiens).
- Durée de chaque séance ≤ durée max indiquée (la sortie longue peut la dépasser de 15 min).
- Mélange intelligent : endurance fondamentale (majoritaire), une séance de qualité (fractionné ou seuil) seulement si le niveau le permet, une sortie longue, du renforcement adapté au matériel disponible, et du gainage. Pour un débutant : alternance course/marche progressive.
- Progression prudente (+10 % de volume de course max par semaine). Toutes les 4 semaines, semaine allégée (−30 %).
- Ajuste selon les résultats réels : séances manquées ou ressenti « trop dur » / effort ≥ 8 sur des séances faciles → allège ; « trop facile » et séances toutes réalisées → progresse un peu. Appuie-toi sur les allures et distances réellement courues plutôt que sur le niveau déclaré.
- Respecte les limitations et blessures.
- Allures en min/km si le chrono 5 km est connu, sinon en sensations (aisance respiratoire).
- Exercices précis : nom de l'exercice + séries × répétitions (ou durée) + récupération. Français, ton motivant et concret.

Réponds avec un objet JSON : "focus" (objectif de la semaine en une phrase) et "jours", les 7 jours avec "jour" de 0 (lundi) à 6 (dimanche), "type", "titre" court, "duree" en minutes, "intensite", "echauffement", "blocs" (nom + détail), "retour" (retour au calme) et "conseil".`;
}

export function mealsPrompt(p: Profile, week: string, training: TrainingPlan | null): string {
  const t = targets(p);
  return `Tu es diététicien·ne du sport. Crée le plan de repas de la semaine du ${frDate(week, { day: 'numeric', month: 'long' })} pour cette personne, en cuisine française du quotidien, simple et gourmande.

PROFIL :
${profileText(p)}

ENTRAÎNEMENTS DE LA SEMAINE : ${training ? training.days.map((d) => DSHORT[d.day] + ' ' + d.type).join(', ') : 'non renseignés'}

RÈGLES :
- Vise environ ${t.kcal} kcal et ${t.prot} g de protéines par jour (un peu plus de glucides les jours de sortie longue ou de fractionné).
- Utilise en priorité les aliments aimés, n'utilise JAMAIS les aliments détestés ni les allergènes, respecte le régime.
- Repas par jour : Petit-déjeuner, Déjeuner, ${p.collation ? 'Collation, ' : ''}Dîner. Varie, mais réutilise les ingrédients pour limiter le gaspillage (restes du dîner pour le déjeuner du lendemain bienvenus).
- Temps de cuisine : ${p.cuisine === 'rapide' ? 'moins de 20 min en semaine' : p.cuisine === 'moyen' ? '30 min max' : 'peut cuisiner plus le week-end'}.
- Ingrédients avec quantités pour 1 personne.

Réponds avec un objet JSON : "jours" (7 jours, "jour" de 0 = lundi à 6 = dimanche, chacun avec ses "repas" : "moment", "nom", "ingredients" avec quantités, "kcal", "prot" en grammes, "temps" de préparation en minutes), "courses" (liste de courses de la semaine regroupée par "rayon") et "astuces" (2 conseils de préparation à l'avance).`;
}

export function swapPrompt(p: Profile, plan: MealPlan, day: number, index: number): string {
  const m = plan.jours[day]!.repas[index]!;
  return `Propose UN autre repas pour remplacer « ${m.nom} » (${m.moment}, environ ${m.kcal || 450} kcal, ${m.prot || 25} g de protéines) dans le plan d'une personne au profil suivant :
${profileText(p)}
Évite ces plats déjà au menu cette semaine : ${plan.jours.flatMap((d) => d.repas.map((r) => r.nom)).join(' ; ')}.
Réponds avec un objet JSON : "moment" (« ${m.moment} »), "nom", "ingredients" avec quantités, "kcal", "prot", "temps".`;
}

export function adaptPrompt(p: Profile, session: PlanSession, ci: { energie: number; temps: number; courbatures: boolean }): string {
  return `Tu es coach sportif. Adapte la séance du jour selon l'état de forme. Profil :
${profileText(p)}

Séance prévue (JSON) :
${JSON.stringify(session)}

État du jour : énergie ${ci.energie}/5, ${ci.courbatures ? 'courbatures ou douleurs musculaires' : 'pas de courbatures'}, temps disponible ${ci.temps ? ci.temps + ' min' : 'comme prévu'}.
Garde l'objectif de la séance si possible, allège si besoin, ou propose une alternative plus douce. Explique ton choix dans "conseil".
Réponds avec un objet JSON de la même forme que la séance prévue.`;
}

export function reviewPrompt(p: Profile, history: string): string {
  return `Tu es le coach sportif et nutrition de cette personne. Fais un bilan honnête et encourageant de sa progression, en t'appuyant uniquement sur les données ci-dessous.

PROFIL :
${profileText(p)}

HISTORIQUE :
${history}

FORMAT : texte simple en français, sans Markdown ni listes à puces, tutoiement, 130 à 180 mots, en trois courts paragraphes : 1) ce qui progresse, avec des chiffres ; 2) le point de vigilance ; 3) la priorité concrète pour la semaine qui vient. Objectif calorique actuel : ${targets(p).kcal} kcal par jour.`;
}

/* ---------- normalisation des réponses ---------- */
export function normSession(d: z.infer<typeof SessionOut> | undefined, day: number): PlanSession {
  const type = d && (SESSION_TYPES as readonly string[]).includes(d.type) ? d.type : 'repos';
  return {
    day, type, titre: str(d?.titre).slice(0, 120) || (type === 'repos' ? 'Repos' : 'Séance'), duree: clamp(Math.round(+(d?.duree ?? 0)) || 0, 0, 600),
    intensite: d?.intensite ?? 'facile', echauffement: str(d?.echauffement).slice(0, 600),
    blocs: (d?.blocs ?? []).map((b) => ({ nom: str(b.nom).slice(0, 200), detail: str(b.detail).slice(0, 600) })).filter((b) => b.nom).slice(0, 30),
    retour: str(d?.retour).slice(0, 600), conseil: str(d?.conseil).slice(0, 800),
  };
}
export function normTraining(j: z.infer<typeof TrainingOut>, p: Profile, week: string): TrainingPlan {
  const days = Array.from({ length: 7 }, (_, i) => normSession(j.jours.find((x) => Math.round(x.jour) === i), i));
  if (!days.some((d) => d.type !== 'repos')) throw new Error('programme vide');
  return { weekKey: week, source: 'claude', semaine: weekIndex(p, week), focus: str(j.focus).slice(0, 300), days };
}
const normMeal = (m: z.infer<typeof MealOut>, moment?: string) => ({
  moment: (moment ?? str(m.moment)).slice(0, 40) || 'Repas', nom: str(m.nom).slice(0, 200), ingredients: m.ingredients.map((s) => str(s).slice(0, 160)).filter(Boolean).slice(0, 40),
  kcal: clamp(Math.round(m.kcal) || 0, 0, 5000), prot: clamp(Math.round(m.prot) || 0, 0, 500), temps: clamp(Math.round(m.temps) || 0, 0, 600),
});
export function normMeals(j: z.infer<typeof MealsOut>, p: Profile, week: string): MealPlan {
  const jours = Array.from({ length: 7 }, (_, i) => ({ day: i, repas: (j.jours.find((x) => Math.round(x.jour) === i)?.repas ?? []).map((m) => normMeal(m)).filter((m) => m.nom).slice(0, 8) }));
  if (jours.filter((d) => d.repas.length).length < 5) throw new Error('menus incomplets');
  const courses = j.courses.map((g) => ({ rayon: str(g.rayon).slice(0, 80) || 'Divers', items: g.items.map((s) => str(s).slice(0, 200)).filter(Boolean).slice(0, 120) })).filter((g) => g.items.length).slice(0, 30);
  const t = targets(p);
  return { weekKey: week, source: 'claude', cibles: { kcal: t.kcal, prot: t.prot }, jours, courses, astuces: str(j.astuces).slice(0, 1500) };
}
export const normSwap = (m: z.infer<typeof MealOut>, moment: string) => normMeal(m, moment);
