-- PostgREST ponekad ne mapira SETOF public.users pouzdano u supabase-js (npr. prazan objekat / bez polja role).
-- Jedan JSON red je stabilniji za klijent.

DROP FUNCTION IF EXISTS public.get_current_user_profile();

CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
  SELECT row_to_json(u)::json
  FROM public.users AS u
  WHERE u.id = auth.uid()
  LIMIT 1;
$func$;

REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated;
