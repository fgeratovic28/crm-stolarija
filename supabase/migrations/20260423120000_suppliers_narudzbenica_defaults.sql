-- Podrazumevani podaci za štampanu porudžbenicu po dobavljaču (povlače se u narudžbinu pri izboru dobavljača)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS nb_buyer_bank_account TEXT,
  ADD COLUMN IF NOT EXISTS nb_shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS nb_payment_days_after_order INTEGER,
  ADD COLUMN IF NOT EXISTS nb_legal_reference TEXT,
  ADD COLUMN IF NOT EXISTS nb_payment_note TEXT,
  ADD COLUMN IF NOT EXISTS nb_delivery_address_override TEXT;

COMMENT ON COLUMN public.suppliers.nb_buyer_bank_account IS 'Podrazumevani žiro račun naručioca (naša firma) za porudžbenicu ka ovom dobavljaču.';
COMMENT ON COLUMN public.suppliers.nb_shipping_method IS 'Podrazumevani način otpreme / isporuke.';
COMMENT ON COLUMN public.suppliers.nb_payment_days_after_order IS 'Broj dana od datuma narudžbine do roka plaćanja (opciono).';
COMMENT ON COLUMN public.suppliers.nb_legal_reference IS 'Podrazumevani pravni osnov (ugovor, ponuda…).';
COMMENT ON COLUMN public.suppliers.nb_payment_note IS 'Podrazumevana napomena o plaćanju.';
COMMENT ON COLUMN public.suppliers.nb_delivery_address_override IS 'Podrazumevana adresa isporuke (ako nije adresa firme iz memoranduma).';
