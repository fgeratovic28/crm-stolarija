-- Stan i sprat na kupcu (opciono), podrazumevana lokacija ugradnje.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS installation_apartment TEXT,
  ADD COLUMN IF NOT EXISTS installation_floor TEXT;

COMMENT ON COLUMN public.customers.installation_apartment IS 'Broj stana / lokala na adresi ugradnje (kupac).';
COMMENT ON COLUMN public.customers.installation_floor IS 'Sprat na adresi ugradnje (kupac).';
