-- Dodaj R2 polja za files tabelu (aktivnosti, materijalne narudžbine, radni nalozi).

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS storage_url text;

COMMENT ON COLUMN public.files.storage_key IS 'R2 object key (npr. files/jobs/...) za brisanje; ako nedostaje, zapis je stariji';
COMMENT ON COLUMN public.files.storage_url IS 'Javni URL u R2 (sačuvan pri otpremi)';
