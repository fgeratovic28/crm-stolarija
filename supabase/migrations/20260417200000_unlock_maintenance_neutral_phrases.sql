-- Novi tekstovi na ekranu: prva slova prvih 5 reči (naslov) daju nove kodove.

CREATE OR REPLACE FUNCTION public.unlock_maintenance_mode(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v text;
BEGIN
  v := lower(trim(both from p_secret));
  -- sr: Ne, možemo, da, prikažemo, stranicu -> nmdps
  -- en: We, can't, load, this, page -> wcltp
  IF v NOT IN ('nmdps', 'wcltp') THEN
    RETURN false;
  END IF;
  UPDATE public.app_settings
  SET maintenance_mode = false
  WHERE id = 1;
  RETURN true;
END;
$func$;
