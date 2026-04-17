-- Explicit deny for authenticated API access to internal counter rows (generators use SECURITY DEFINER).
-- Clears advisor INFO "RLS enabled but no policy" while keeping counters non-readable via PostgREST.

DROP POLICY IF EXISTS job_number_counters_no_direct_api ON public.job_number_counters;
DROP POLICY IF EXISTS customer_number_counters_no_direct_api ON public.customer_number_counters;

CREATE POLICY job_number_counters_no_direct_api ON public.job_number_counters
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY customer_number_counters_no_direct_api ON public.customer_number_counters
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
