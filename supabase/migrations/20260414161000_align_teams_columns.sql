-- Usklađivanje `teams` tabele sa aplikacijom.
-- Bezbedno dodaje kolone koje UI očekuje, samo ako ne postoje.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS specialty text;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  -- Ako je u starijoj šemi korišćen `is_active`, prepiši vrednosti u `active`.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE 'UPDATE public.teams SET active = COALESCE(is_active, active, true)';
  END IF;
END $$;

