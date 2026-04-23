-- Tekst reklamacije dobavljaču i oznaka da je korisnik potvrdio usaglašenost sa SEF XML (e-račun).
ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS supplier_complaint_note text,
  ADD COLUMN IF NOT EXISTS sef_reconciliation_at timestamptz;

COMMENT ON COLUMN public.material_orders.supplier_complaint_note IS 'Reklamacija / primedba dobavljaču (npr. posle poređenja sa SEF e-računom).';
COMMENT ON COLUMN public.material_orders.sef_reconciliation_at IS 'Vreme kada je korisnik potvrdio da se SEF dokument poklapa sa narudžbinom.';
