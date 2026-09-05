CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS business_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_settings (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 assistant_id text NOT NULL, name text NOT NULL, instructions text NOT NULL DEFAULT '',
 PRIMARY KEY(user_id, assistant_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 customer_id text UNIQUE, subscription_id text UNIQUE, status text NOT NULL DEFAULT 'none',
 paid boolean NOT NULL DEFAULT false, period_start timestamptz, period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS generations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL, assistant_id text NOT NULL, assistant_name text NOT NULL,
 inputs jsonb NOT NULL, context jsonb NOT NULL, instructions text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','completed','failed')),
 output text, model text, input_tokens integer, output_tokens integer, cost_usd numeric,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, request_key)
);
CREATE INDEX IF NOT EXISTS generations_user_date ON generations(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS stripe_events (id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS preview_budget_lock (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO preview_budget_lock(id) VALUES(1) ON CONFLICT DO NOTHING;
