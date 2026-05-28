CREATE TABLE IF NOT EXISTS inbound_email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT[] NOT NULL,
  subject TEXT NOT NULL,
  message_id TEXT,
  forwarded_to TEXT NOT NULL,
  forwarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'forwarded',
  error_message TEXT,
  raw_event JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_logs_email_id ON inbound_email_logs (email_id);
CREATE INDEX IF NOT EXISTS idx_inbound_email_logs_forwarded_at ON inbound_email_logs (forwarded_at DESC);
