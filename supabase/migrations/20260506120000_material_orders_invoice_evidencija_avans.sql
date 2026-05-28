-- Evidencija fakture / avans plaćanje nabavke (kolone na material_orders = porudžbine nabavke).

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_file_url text;

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS payment_status text;

UPDATE public.material_orders
SET payment_status = CASE WHEN paid IS TRUE THEN 'paid_advance' ELSE 'pending' END
WHERE payment_status IS NULL;

ALTER TABLE public.material_orders
  ALTER COLUMN payment_status SET DEFAULT 'pending';

ALTER TABLE public.material_orders
  ALTER COLUMN payment_status SET NOT NULL;

ALTER TABLE public.material_orders
  DROP CONSTRAINT IF EXISTS material_orders_payment_status_check;

ALTER TABLE public.material_orders
  ADD CONSTRAINT material_orders_payment_status_check CHECK (payment_status IN ('pending', 'paid_advance'));

COMMENT ON COLUMN public.material_orders.invoice_number IS 'Broj fakture dobavljača (ručan unos).';
COMMENT ON COLUMN public.material_orders.invoice_amount IS 'Iznos fakture (RSD), ručan unos.';
COMMENT ON COLUMN public.material_orders.invoice_file_url IS 'Javni R2 URL skenirane / PDF fakture.';
COMMENT ON COLUMN public.material_orders.payment_status IS 'pending | paid_advance (avans plaćen).';

-- Finansije: pregled i ažuriranje evidencije fakture / avansa
DROP POLICY IF EXISTS finance_read_material_orders ON public.material_orders;
CREATE POLICY finance_read_material_orders ON public.material_orders
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'finance');

DROP POLICY IF EXISTS finance_update_material_orders ON public.material_orders;
CREATE POLICY finance_update_material_orders ON public.material_orders
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'finance')
  WITH CHECK (public.get_current_user_role() = 'finance');
