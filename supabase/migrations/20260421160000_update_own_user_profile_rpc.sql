-- Omogućava svakom ulogovanom korisniku da ažurira sopstveno ime bez admin RLS politike
-- (samo name i full_name; uloga, tim, aktivnost ostaju pod admin kontrolom).

CREATE OR REPLACE FUNCTION public.update_own_user_profile(p_name text, p_full_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  UPDATE public.users
  SET
    name = btrim(p_name),
    full_name = NULLIF(btrim(COALESCE(p_full_name, '')), '')
  WHERE id = auth.uid();
END;
$func$;

REVOKE ALL ON FUNCTION public.update_own_user_profile(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_user_profile(text, text) TO authenticated;
