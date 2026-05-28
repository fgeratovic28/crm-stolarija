-- Kancelarija potvrdi da početna ponuda ostaje posle merenja (bez nove verzije u sistemu).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS post_measurement_keep_initial_quote boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.post_measurement_keep_initial_quote IS
  'True kada je kancelarija potvrdila da postojeća ponuda važi posle merenja (banner „Zadrži postojeću ponudu“).';
