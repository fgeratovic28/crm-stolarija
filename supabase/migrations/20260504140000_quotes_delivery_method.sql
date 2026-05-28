-- Evidencija kanala slanja ponude (pored slanja mejlom iz sistema).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'not_sent';

COMMENT ON COLUMN public.quotes.delivery_method IS
  'Kanal slanja: not_sent | email_system | viber_whatsapp | printed_in_person | other.';

-- Postojeće poslate/prihvaćene ponude: kanal bio nepoznat → other (ne ostavljati not_sent).
UPDATE public.quotes q
SET delivery_method = 'other'
WHERE q.delivery_method = 'not_sent'
  AND q.status IN ('sent', 'accepted');
