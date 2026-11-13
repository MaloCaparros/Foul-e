# Foulée

Coach personnel : programme de course et de renforcement, menus de la semaine, suivi de la progression.
Application web complète : interface, API REST, base de données PostgreSQL, comptes utilisateurs.

## Architecture

```
web/            interface (HTML, CSS, JavaScript sans framework), servie par le serveur
src/
  server.ts     point d'entrée : configuration, base, migrations, écoute
  app.ts        serveur Fastify : sécurité, erreurs, routes, fichiers statiques
  auth.ts       comptes, sessions par cookie, protection CSRF
  db.ts         accès PostgreSQL (pool `pg`) ou PostgreSQL embarqué (PGlite), migrations
  schemas.ts    validation de toutes les entrées (zod)
  routes/data.ts  profil, programmes, séances, pesées, mensurations, tests, statistiques, export
  routes/ai.ts    génération par Claude (programme, menus, adaptation, bilan)
  coach/          calcul des besoins, consignes envoyées au modèle, normalisation des réponses
migrations/     schéma SQL, appliqué automatiquement au démarrage
test/           tests d'intégration de l'API
```

- **Base de données** : PostgreSQL. Tables `users`, `auth_sessions`, `profiles`, `plans` (un programme et un menu par semaine, l'historique est conservé), `workouts`, `weights`, `measures`, `tests`, `user_state`. Chaque ligne appartient à un utilisateur ; supprimer un compte supprime ses données en cascade.
- **Sécurité** : mots de passe hachés (scrypt), jeton de session aléatoire dont seul le hachage est stocké, cookie `HttpOnly` + `SameSite=Lax`, vérification de l'origine sur les requêtes qui modifient des données, validation stricte des entrées, limitation de débit, en-têtes de sécurité (CSP).
- **Hors ligne** : l'interface garde une copie locale ; une saisie faite sans réseau est renvoyée à la reconnexion. Les identifiants sont fournis par le client et les écritures sont des `PUT` idempotents : un renvoi ne crée jamais de doublon.
- **Génération** : le générateur intégré (programme et menus de base) tourne dans le navigateur. Avec une clé API Anthropic, le serveur demande à Claude un programme sur mesure à partir du profil et de l'historique réel lus en base.

## Lancer en local

Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

L'application est sur http://localhost:3000. Sans `DATABASE_URL`, elle crée une base PostgreSQL embarquée dans `./data/pgdata` : rien d'autre à installer.

Pour utiliser un vrai serveur PostgreSQL et activer Claude, copier `.env.example` en `.env`, le remplir, puis :

```bash
node --env-file=.env --import tsx src/server.ts
```

## Tests

```bash
npm test
```

Les tests démarrent l'API sur une base en mémoire. Pour les jouer sur un vrai PostgreSQL (la base indiquée est vidée) :

```bash
TEST_DATABASE_URL=postgres://user:mdp@localhost:5432/foulee_test npm test
```

## Déployer

Avec Docker (application + PostgreSQL) :

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d --build
```

En production, placer l'application derrière un proxy HTTPS : avec `NODE_ENV=production`, le cookie de session n'est envoyé qu'en HTTPS.

Sur un hébergeur (Render, Railway, Fly.io…) : créer une base PostgreSQL, définir `DATABASE_URL` et `NODE_ENV=production`, commande de build `npm ci && npm run build`, commande de démarrage `npm start`. Les migrations s'appliquent au démarrage.

Une fois ton compte créé, mettre `ALLOW_REGISTRATION=false` pour fermer les inscriptions.

## API

Toutes les routes sont sous `/api`, en JSON. Les erreurs ont la forme `{ "error": { "code", "message", "details"? } }`.
Les dates sont au format `AAAA-MM-JJ` ; une semaine est désignée par son lundi.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Créer un compte, se connecter (`{ email, password }`) |
| POST | `/auth/logout` | Se déconnecter |
| GET | `/auth/me` | Utilisateur connecté |
| DELETE | `/account` | Supprimer le compte et ses données (`{ password }`) |
| GET | `/bootstrap?week=` | Tout ce qu'il faut à l'ouverture : profil, programmes de la semaine, historique |
| GET, PUT | `/profile` | Profil |
| GET, PUT | `/plans/{training\|meals}/{semaine}` | Programme ou menus d'une semaine |
| GET | `/weeks?week=` | Résumé des semaines passées |
| PUT | `/state` | État d'interface (cases cochées, forme du jour, chrono…) |
| GET | `/sessions?from=&to=` | Séances réalisées |
| PUT, DELETE | `/sessions/{id}` | Enregistrer ou supprimer une séance (l'allure est calculée par le serveur) |
| GET | `/weights`, `/measures`, `/tests` | Pesées, mensurations, tests |
| PUT, DELETE | `/weights/{date}`, `/measures/{date}`, `/tests/{id}` | Enregistrer ou supprimer |
| GET | `/stats/weekly?week=&weeks=` | Agrégats par semaine (minutes, km, séances faites / prévues, poids moyen) |
| GET | `/export` | Export complet en JSON |
| DELETE | `/data` | Effacer les données de suivi en gardant le compte |
| POST | `/ai/training`, `/ai/meals`, `/ai/swap-meal`, `/ai/adapt`, `/ai/review` | Génération par Claude (503 `ai_disabled` sans clé API) |
| GET | `/health` | État du serveur et de la base |

## Coût de la génération par Claude

Chaque génération appelle l'API Anthropic avec la clé du serveur et est facturée à l'usage. Le serveur limite à 30 générations par heure et par utilisateur. Le modèle se change avec `AI_MODEL`.
