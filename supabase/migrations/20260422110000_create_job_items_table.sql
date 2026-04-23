CREATE TABLE IF NOT EXISTS public.job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  profile_code text,
  profile_title text,
  color text,
  cut_length numeric,
  quantity integer,
  barcode text,
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_items_job_id ON public.job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_job_items_job_barcode ON public.job_items(job_id, barcode);

ALTER TABLE public.job_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_job_items ON public.job_items;
CREATE POLICY admin_all_job_items
  ON public.job_items
  FOR ALL
  TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

DROP POLICY IF EXISTS staff_read_job_items ON public.job_items;
CREATE POLICY staff_read_job_items
  ON public.job_items
  FOR SELECT
  TO authenticated
  USING (
    public.get_current_user_role() IN ('admin', 'office', 'procurement', 'production')
  );

DROP POLICY IF EXISTS procurement_office_write_job_items ON public.job_items;
CREATE POLICY procurement_office_write_job_items
  ON public.job_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'office', 'procurement')
  );

DROP POLICY IF EXISTS procurement_office_update_job_items ON public.job_items;
CREATE POLICY procurement_office_update_job_items
  ON public.job_items
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role() IN ('admin', 'office', 'procurement', 'production')
  )
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'office', 'procurement', 'production')
  );

DROP POLICY IF EXISTS procurement_office_delete_job_items ON public.job_items;
CREATE POLICY procurement_office_delete_job_items
  ON public.job_items
  FOR DELETE
  TO authenticated
  USING (
    public.get_current_user_role() IN ('admin', 'office', 'procurement')
  );
