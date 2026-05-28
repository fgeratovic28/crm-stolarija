-- Realtime za ostale tabele koje globalni klijent prati (ceo CRM, ne samo dashboard).

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activities'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.activities;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quotes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.job_items;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'files'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_order_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.work_order_items;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'suppliers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
    END IF;
  END IF;
END;
$migration$;
