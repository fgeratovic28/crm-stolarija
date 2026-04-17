-- Vozila: kilometraža na kojoj je odrađen servis
ALTER TABLE public.vehicles
  ADD COLUMN service_kilometers INTEGER;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_service_kilometers_non_negative
  CHECK (service_kilometers IS NULL OR service_kilometers >= 0);

