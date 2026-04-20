-- Kolone iz 20260416135500 / 20260416131000 koje često nedostaju ako migracije nisu primenjene na remote.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS service_kilometers INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vehicles_service_kilometers_non_negative'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_service_kilometers_non_negative
      CHECK (service_kilometers IS NULL OR service_kilometers >= 0);
  END IF;
END;
$$;
