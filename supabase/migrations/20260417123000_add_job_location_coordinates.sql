-- Store normalized coordinates for job location mapping.
-- Nullable by design to keep rollout safe for existing records.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS installation_lat double precision,
  ADD COLUMN IF NOT EXISTS installation_lng double precision,
  ADD COLUMN IF NOT EXISTS installation_location_source text;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_installation_coordinates_pair_chk
  CHECK (
    (installation_lat IS NULL AND installation_lng IS NULL)
    OR (installation_lat IS NOT NULL AND installation_lng IS NOT NULL)
  );

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_installation_lat_range_chk
  CHECK (installation_lat IS NULL OR (installation_lat >= -90 AND installation_lat <= 90));

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_installation_lng_range_chk
  CHECK (installation_lng IS NULL OR (installation_lng >= -180 AND installation_lng <= 180));
