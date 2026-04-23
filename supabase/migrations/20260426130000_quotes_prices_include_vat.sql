ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS prices_include_vat boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.quotes.prices_include_vat IS
  'Da li su jedinične cene u ponudi sa uključenim PDV-om.';
