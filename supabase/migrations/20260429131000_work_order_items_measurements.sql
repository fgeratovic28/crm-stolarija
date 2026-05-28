-- Mere unešene uz stavku čekliste (RN merenje).

ALTER TABLE public.work_order_items
  ADD COLUMN IF NOT EXISTS measurements text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.work_order_items.measurements IS 'Mere upisane na terenu za ovu stavku (merenje), prikažu se u izveštaju uz opis stavke.';
