-- Realtime: promene na radnim nalozima (npr. dodela tima) da odmah invalidiraju terenski dashboard preko postgres_changes.

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_orders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.work_orders;
    END IF;
  END IF;
END;
$migration$;
