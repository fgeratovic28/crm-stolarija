-- PDV evidencija: stope na ponudama i poslovima (0%, 20%), ulazni PDV po narudžbini nabavke.
-- Postojeći poslovi: podrazumevano 0% stope; vat_amount se nuluje tako da ceo total_price ostaje „osnovica“ (ukupni iznos bez posebnog PDV reda).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS vat_rate_percent SMALLINT NOT NULL DEFAULT 0
    CHECK (vat_rate_percent IN (0, 20));

COMMENT ON COLUMN public.jobs.vat_rate_percent IS 'Stopa PDV za obračun cene posla klijentu: 0 ili 20.';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS vat_rate_percent SMALLINT NOT NULL DEFAULT 0
    CHECK (vat_rate_percent IN (0, 20));

COMMENT ON COLUMN public.quotes.vat_rate_percent IS 'Stopa PDV ponude za sinhronizaciju na posao pri prihvatanju (0 ili 20).';

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS supplier_incoming_vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.material_orders.supplier_incoming_vat_amount IS 'Ukupan naknadni ulazni PDV sa fakture/predračuna dobavljača (procenat ili ručni iznos za PDV presek).';

-- Legacy: sve postojeće stope ostaju 0 (DEFAULT po dodavanju kolone); obrisi staru vrednost vat_amount da prikaz PDV odgovara 0% štoperi.
UPDATE public.jobs SET vat_amount = 0 WHERE vat_rate_percent = 0;
