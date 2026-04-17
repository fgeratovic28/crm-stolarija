-- Vozila: URL/reference polja za slike dokumenata
ALTER TABLE public.vehicles
  ADD COLUMN traffic_permit_image_url TEXT,
  ADD COLUMN insurance_image_url TEXT,
  ADD COLUMN service_record_image_url TEXT,
  ADD COLUMN additional_image_urls TEXT[] DEFAULT '{}';

