-- Sinhronizacija cene posla sa finalnom ponudom (klijent briše/ubacuje job_quote_lines i UPDATE jobs).
-- Finansije su imale samo SELECT na job_quote_lines i jobs, pa je sync ćutao (0 redova / RLS).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.is_final IS
  'Kada je true, ponuda se tretira kao finalna (sinhronizacija stavki i iznosa na posao iz aplikacije).';

-- job_quote_lines: finansije — upis / izmena / brisanje za poslove koje smeju da vide
DROP POLICY IF EXISTS finance_job_quote_lines_insert ON public.job_quote_lines;
CREATE POLICY finance_job_quote_lines_insert ON public.job_quote_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'finance'
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_quote_lines.job_id)
  );

DROP POLICY IF EXISTS finance_job_quote_lines_update ON public.job_quote_lines;
CREATE POLICY finance_job_quote_lines_update ON public.job_quote_lines
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'finance'
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_quote_lines.job_id)
  )
  WITH CHECK (
    public.get_current_user_role() = 'finance'
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_quote_lines.job_id)
  );

DROP POLICY IF EXISTS finance_job_quote_lines_delete ON public.job_quote_lines;
CREATE POLICY finance_job_quote_lines_delete ON public.job_quote_lines
  FOR DELETE TO authenticated
  USING (
    public.get_current_user_role() = 'finance'
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_quote_lines.job_id)
  );

-- jobs: finansije — ažuriranje (npr. total_price, vat_amount, prices_include_vat posle finalne ponude)
DROP POLICY IF EXISTS finance_jobs_update ON public.jobs;
CREATE POLICY finance_jobs_update ON public.jobs
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'finance')
  WITH CHECK (public.get_current_user_role() = 'finance');
