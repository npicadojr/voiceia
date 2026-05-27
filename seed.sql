-- Voice AI System — Supabase Schema (Multi-tenant)
-- Pegar en: Supabase Dashboard → SQL Editor → New query → Run

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(120) NOT NULL,
  slug                 VARCHAR(60)  UNIQUE NOT NULL,
  phone_number         VARCHAR(20),
  elevenlabs_voice_id  VARCHAR(80),
  human_agent_number   VARCHAR(20),
  api_key              VARCHAR(80)  UNIQUE NOT NULL,
  default_agent        VARCHAR(30)  DEFAULT 'leadQualifier',
  google_refresh_token TEXT,
  google_calendar_id   VARCHAR(120) DEFAULT 'primary',
  active               BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Agent configs (custom prompts/greetings per tenant per agent) ─────────────
CREATE TABLE IF NOT EXISTS agent_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_type    VARCHAR(30) NOT NULL,
  system_prompt TEXT,
  greeting_text TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, agent_type)
);

-- ── Calls ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id),
  call_sid         VARCHAR(64) UNIQUE,
  direction        VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status           VARCHAR(20) NOT NULL DEFAULT 'initiated'
                     CHECK (status IN ('initiated','ringing','in-progress','completed','failed','busy','no-answer','transferred')),
  agent_type       VARCHAR(30) NOT NULL DEFAULT 'leadQualifier',
  from_number      VARCHAR(20),
  to_number        VARCHAR(20),
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url    TEXT,
  extracted_data   JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','system')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leads ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id),
  phone          VARCHAR(20) UNIQUE,
  name           VARCHAR(120),
  email          VARCHAR(120),
  company        VARCHAR(120),
  interest_level VARCHAR(10) CHECK (interest_level IN ('low','medium','high')),
  budget         VARCHAR(80),
  timeline       VARCHAR(80),
  notes          TEXT,
  source_call_id UUID REFERENCES calls(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tenants_slug        ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_id     ON calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_sid      ON calls(call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_status        ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at    ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_call_id    ON messages(call_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id     ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone         ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs(tenant_id);

-- ── Migration (si ya tienes tablas sin tenant_id) ────────────────────────────
-- ALTER TABLE calls ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
-- ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
