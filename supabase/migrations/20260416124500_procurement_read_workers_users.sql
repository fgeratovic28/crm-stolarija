-- Procurement mora moći da učita radnike (production/montaza/teren) iz users
-- kako bi mogao da zaduži vozilo (dropdown u UI-ju).

CREATE POLICY procurement_read_worker_users ON public.users
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'procurement'
    AND role IN ('production', 'montaza', 'teren')
  );

