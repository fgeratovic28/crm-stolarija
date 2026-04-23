-- Uklanjanje roka važenja sa ponuda (više se ne koristi u aplikaciji).
ALTER TABLE public.quotes
  DROP COLUMN IF EXISTS valid_until;
