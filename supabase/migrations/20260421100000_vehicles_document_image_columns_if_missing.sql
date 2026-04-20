-- Ako udaljena baza nema kolone iz 20260416133000 (ili je migracija preskočena), PostgREST javlja
-- "Could not find the 'additional_image_urls' column ... in the schema cache".
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS traffic_permit_image_url TEXT,
  ADD COLUMN IF NOT EXISTS insurance_image_url TEXT,
  ADD COLUMN IF NOT EXISTS service_record_image_url TEXT,
  ADD COLUMN IF NOT EXISTS additional_image_urls TEXT[] DEFAULT '{}'::text[];
