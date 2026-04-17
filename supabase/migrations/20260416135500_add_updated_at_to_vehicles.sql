-- Vozila: timestamp poslednje izmene (za timeline/prikaz detalja)
ALTER TABLE public.vehicles
  ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

