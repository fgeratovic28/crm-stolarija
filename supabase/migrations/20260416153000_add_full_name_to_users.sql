-- users.full_name: prikaz punog imena (ime i prezime), odvojeno od username/name vrednosti.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Postojecim korisnicima barem prenesi trenutni naziv.
UPDATE public.users
SET full_name = NULLIF(BTRIM(name), '')
WHERE full_name IS NULL;

-- Novi korisnici: popuni full_name iz metadata ako postoji.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  INSERT INTO public.users (id, email, name, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', 'Korisnik'),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', NULL),
    'office'
  );
  RETURN new;
END;
$func$;
