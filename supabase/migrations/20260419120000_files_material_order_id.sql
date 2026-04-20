-- Prilozi uz narudžbinu materijala (više fajlova po narudžbini)
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS material_order_id UUID REFERENCES public.material_orders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_files_material_order_id ON public.files(material_order_id);

COMMENT ON COLUMN public.files.material_order_id IS 'Opciono: fajl vezan direktno za narudžbinu materijala (prilozi, generisani PDF).';
