-- Dinamička tabela stavki (Excel smart reader) — JSON bez menjanja šeme nb_lines
ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS items_json jsonb;

COMMENT ON COLUMN public.material_orders.items_json IS 'Smart Excel: kolone + redovi + ključevi artikla/šifre/količine (verzija 1).';
