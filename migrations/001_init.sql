-- Foulée — schéma initial (PostgreSQL 14+)

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Sessions de connexion : seul le hachage du jeton est stocké.
CREATE TABLE auth_sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

-- Profil (réglages) : un document validé par l'API.
CREATE TABLE profiles (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Programmes d'entraînement et menus, un par semaine (lundi). L'historique des semaines reste en base.
CREATE TABLE plans (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('training', 'meals')),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  source     text NOT NULL CHECK (source IN ('local', 'claude')),
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, week_start)
);

-- État courant de l'interface (cases cochées, forme du jour, chrono, liste de courses, dernier bilan).
CREATE TABLE user_state (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Séances réalisées. L'identifiant est fourni par le client : un envoi rejoué ne crée pas de doublon.
CREATE TABLE workouts (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id           text NOT NULL,
  date         date NOT NULL,
  type         text NOT NULL CHECK (type IN ('course', 'renfo', 'mixte', 'mobilite', 'autre')),
  title        text NOT NULL DEFAULT '',
  planned      boolean NOT NULL DEFAULT false,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 0 AND 600),
  distance_km  numeric(6, 2) NOT NULL DEFAULT 0 CHECK (distance_km BETWEEN 0 AND 300),
  pace_sec     integer NOT NULL DEFAULT 0 CHECK (pace_sec >= 0),
  rpe          smallint NOT NULL DEFAULT 0 CHECK (rpe BETWEEN 0 AND 10),
  feeling      text NOT NULL DEFAULT 'ok' CHECK (feeling IN ('facile', 'ok', 'dur')),
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX workouts_user_date_idx ON workouts (user_id, date);

CREATE TABLE weights (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  kg         numeric(5, 1) NOT NULL CHECK (kg BETWEEN 30 AND 250),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE measures (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  waist_cm   numeric(5, 1) CHECK (waist_cm BETWEEN 40 AND 200),
  hips_cm    numeric(5, 1) CHECK (hips_cm BETWEEN 40 AND 200),
  chest_cm   numeric(5, 1) CHECK (chest_cm BETWEEN 40 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date),
  CHECK (waist_cm IS NOT NULL OR hips_cm IS NOT NULL OR chest_cm IS NOT NULL)
);

-- Tests de performance : valeur en secondes (temps) ou en répétitions selon le test.
CREATE TABLE tests (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         text NOT NULL,
  date       date NOT NULL,
  test       text NOT NULL CHECK (test IN ('5km', '10km', '1km', 'pompes', 'gainage', 'squats', 'tractions')),
  value      integer NOT NULL CHECK (value BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX tests_user_date_idx ON tests (user_id, date);
