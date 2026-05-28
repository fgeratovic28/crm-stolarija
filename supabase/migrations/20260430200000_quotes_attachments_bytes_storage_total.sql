-- Zbir veličine priloga ponuda (R2) — uključuje se u prikaz zauzetosti „Skladište“ u sidebaru.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS attachments_total_bytes bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.quotes.attachments_total_bytes IS
  'Zbir veličina datoteka u prilogu ponude u bajtovima; održava aplikacija pri otpremi.';

CREATE OR REPLACE FUNCTION public.files_storage_total_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $$
  SELECT (
    COALESCE((SELECT SUM(f.size_bytes) FROM public.files f), 0)::bigint
    + COALESCE((SELECT SUM(q.attachments_total_bytes) FROM public.quotes q), 0)::bigint
  );
$$;

COMMENT ON FUNCTION public.files_storage_total_bytes() IS 'Zbir veličina: files.size_bytes + quotes.attachments_total_bytes (RLS na obe tabele).';
