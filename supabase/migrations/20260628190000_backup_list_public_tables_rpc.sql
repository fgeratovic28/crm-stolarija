-- RPC za backup-sql Edge funkciju: lista svih public tabela (bez ručnog održavanja liste).
CREATE OR REPLACE FUNCTION public.backup_list_public_tables()
RETURNS TABLE(tablename text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT t.tablename::text
  FROM pg_catalog.pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename;
$$;

REVOKE ALL ON FUNCTION public.backup_list_public_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_list_public_tables() TO service_role;
