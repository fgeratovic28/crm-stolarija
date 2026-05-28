-- Nabavni workflow: statusi + URL predračuna od dobavljača + iznos predračuna

ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'sent_to_supplier';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'waiting_for_payment';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'waiting_for_delivery';

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS supplier_proforma_url text,
  ADD COLUMN IF NOT EXISTS supplier_proforma_total numeric(14, 2);

COMMENT ON COLUMN public.material_orders.supplier_proforma_url IS 'Javni R2 URL predračuna od dobavljača (nakon otpreme).';
COMMENT ON COLUMN public.material_orders.supplier_proforma_total IS 'Ukupan iznos sa predračuna (RSD), usklađen sa supplier_price pri unosu.';
