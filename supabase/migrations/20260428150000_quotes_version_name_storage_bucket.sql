-- Ručno otpremljene ponude: prikazna oznaka verzije (fajlovi na R2, vidi `files/quotes/…`)
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS version_name text;

COMMENT ON COLUMN public.quotes.version_name IS 'Korisnički naziv verzije (npr. Opcija 1 - Rehau).';
