-- Poslovi: ko je kreirao, način PDV-a, stavke ponude (bez tima na poslu — tim ostaje na radnim nalozima)

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS prices_include_vat BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_created_by ON jobs(created_by);

CREATE TABLE job_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_job_quote_lines_job ON job_quote_lines(job_id);

ALTER TABLE job_quote_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_job_quote_lines ON job_quote_lines FOR ALL TO authenticated
  USING (get_current_user_role() = 'admin');

CREATE POLICY office_job_quote_lines ON job_quote_lines FOR ALL TO authenticated
  USING (get_current_user_role() = 'office');

CREATE POLICY finance_job_quote_lines ON job_quote_lines FOR SELECT TO authenticated
  USING (get_current_user_role() = 'finance');

CREATE POLICY procurement_job_quote_lines ON job_quote_lines FOR SELECT TO authenticated
  USING (get_current_user_role() = 'procurement');

CREATE POLICY production_job_quote_lines ON job_quote_lines FOR SELECT TO authenticated
  USING (get_current_user_role() = 'production');

CREATE POLICY montaza_job_quote_lines ON job_quote_lines FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY teren_job_quote_lines ON job_quote_lines FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );
