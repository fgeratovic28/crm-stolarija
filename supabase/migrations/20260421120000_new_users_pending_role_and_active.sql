-- Registracija: bez automatske uloge (Kancelarija/Prodaja) dok admin ne dodeli ulogu.
-- Nalog je neaktivan do dodele uloge; aplikacija koristi pending-approval tok.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.users
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE public.users
  ALTER COLUMN role DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  INSERT INTO public.users (id, email, name, full_name, role, active)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', 'Korisnik'),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', NULL),
    NULL,
    false
  );
  RETURN new;
END;
$func$;
