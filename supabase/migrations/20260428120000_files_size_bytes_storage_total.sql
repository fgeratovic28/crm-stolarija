-- Tačna suma veličine fajlova (sidebar / kvota). Postojeći redovi ostaju 0 dok se ne zamene.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.files.size_bytes IS 'Veličina fajla u bajtovima (zbir za prikaz iskorišćenog skladišta).';

CREATE OR REPLACE FUNCTION public.files_storage_total_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $$
  SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM public.files;
$$;

COMMENT ON FUNCTION public.files_storage_total_bytes() IS 'Zbir size_bytes za sve redove koje korisnik sme da vidi (RLS).';

REVOKE ALL ON FUNCTION public.files_storage_total_bytes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.files_storage_total_bytes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.files_storage_total_bytes() TO service_role;
