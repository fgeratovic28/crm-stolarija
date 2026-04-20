-- Profil za trenutnu sesiju: pouzdan SELECT bez obzira na RLS (rešava slučaj kada get_current_user_role()
-- vraća NULL pa politike ne dozvoljavaju čitanje public.users).
-- Brisanje korisnika: admin (aktivan) može obrisati drugog korisnika iz auth + public.

-- Povrat pristupa ako je admin red ostao neaktivan posle testiranja UI-ja.
UPDATE public.users
SET active = true
WHERE role = 'admin'::public.user_role
  AND active IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS SETOF public.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
  SELECT *
  FROM public.users
  WHERE id = auth.uid();
$func$;

REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot_delete_self';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'::public.user_role
      AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- public.users se briše kaskadno (FK ka auth.users).
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$func$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
