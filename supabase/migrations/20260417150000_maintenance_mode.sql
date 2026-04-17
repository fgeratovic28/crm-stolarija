-- Privremeno gašenje sistema: globalni flag + RPC da svi ulogovani vide stanje bez SELECT-a na ceo red.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.maintenance_mode IS 'Kada je true, klijent blokira celu aplikaciju ukljucujuci prijavu (svi korisnici).';

CREATE OR REPLACE FUNCTION public.get_maintenance_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
  SELECT COALESCE(
    (SELECT maintenance_mode FROM public.app_settings WHERE id = 1 LIMIT 1),
    false
  );
$func$;

REVOKE ALL ON FUNCTION public.get_maintenance_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_maintenance_mode() TO authenticated;
