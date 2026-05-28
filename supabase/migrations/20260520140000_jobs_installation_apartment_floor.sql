-- Stan i sprat na poslu (opciono), za prikaz na RN merenja i ugradnje.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS installation_apartment TEXT,
  ADD COLUMN IF NOT EXISTS installation_floor TEXT;

COMMENT ON COLUMN public.jobs.installation_apartment IS 'Broj stana / lokala na adresi ugradnje (posao).';
COMMENT ON COLUMN public.jobs.installation_floor IS 'Sprat na adresi ugradnje (posao).';
