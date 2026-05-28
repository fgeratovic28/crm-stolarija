-- Ako čitanje uloge bací grešku (retki oštećeni red, privremeni problem šeme), polítike RLs ne smeju
-- rušiti ceo PostgREST upit — vraća se NULL što daje isto ponašanje kao nedostatak reda.

CREATE OR REPLACE FUNCTION public.get_current_user_role()
 RETURNS public.user_role
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO public
AS $func$
DECLARE
  ret public.user_role;
BEGIN
  SELECT u.role
  INTO ret
  FROM public.users AS u
  WHERE u.id = auth.uid()
  LIMIT 1;
  RETURN ret;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$func$;

ALTER FUNCTION public.get_current_user_role() SET search_path TO public;
