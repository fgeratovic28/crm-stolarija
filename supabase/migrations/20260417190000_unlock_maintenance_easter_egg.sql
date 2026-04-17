-- Skriveni "otključaj" sa ekrana blokade: RPC proverava kod (prva slova prvih 5 reči naslov+opis na sr/en u klijentu).

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
  -- sr: Sistem, privremeno, nedostupan, Potpuna, blokada: -> spnpb
  -- en: System, temporarily, unavailable, Full, lockdown: -> stufl
  IF v NOT IN ('spnpb', 'stufl') THEN
    RETURN false;
  END IF;
  UPDATE public.app_settings
  SET maintenance_mode = false
  WHERE id = 1;
  RETURN true;
END;
$func$;

REVOKE ALL ON FUNCTION public.unlock_maintenance_mode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_maintenance_mode(text) TO anon;
GRANT EXECUTE ON FUNCTION public.unlock_maintenance_mode(text) TO authenticated;
