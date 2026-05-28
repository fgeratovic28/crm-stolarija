-- Realtime: narudžbine, poslovi (status / upozorenja) i beleške prodajnih alertova — odmah osvežavanje u klijentu.

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'material_orders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.material_orders;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jobs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sales_alert_notes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_alert_notes;
    END IF;
  END IF;
END;
$migration$;
