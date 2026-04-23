DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'quote_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.quote_status AS ENUM ('draft', 'sent', 'accepted', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  quote_number text NOT NULL,
  version_number integer NOT NULL,
  status public.quote_status NOT NULL DEFAULT 'draft',
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  note text,
  valid_until date,
  file_url text,
  file_storage_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  quantity numeric(12, 2) NOT NULL DEFAULT 1,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_job_id_created_at ON public.quotes(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote_id_sort ON public.quote_lines(quote_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_job_version ON public.quotes(job_id, version_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_single_accepted_per_job
  ON public.quotes(job_id)
  WHERE status = 'accepted'::public.quote_status;

CREATE OR REPLACE FUNCTION public.assign_quote_sequence_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_next_version integer;
  v_job_number text;
BEGIN
  IF NEW.version_number IS NOT NULL AND NEW.version_number > 0 THEN
    v_next_version := NEW.version_number;
  ELSE
    SELECT COALESCE(MAX(q.version_number), 0) + 1
    INTO v_next_version
    FROM public.quotes q
    WHERE q.job_id = NEW.job_id;
  END IF;

  NEW.version_number := v_next_version;

  IF COALESCE(BTRIM(NEW.quote_number), '') = '' THEN
    SELECT j.job_number INTO v_job_number
    FROM public.jobs j
    WHERE j.id = NEW.job_id;

    NEW.quote_number := COALESCE(v_job_number, NEW.job_id::text) || '-P' || v_next_version::text;
  END IF;

  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.sync_job_status_from_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_status public.job_status;
  v_locked boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT j.status, COALESCE(j.status_locked, false)
  INTO v_job_status, v_locked
  FROM public.jobs j
  WHERE j.id = NEW.job_id;

  IF v_locked THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'sent'::public.quote_status AND v_job_status = 'new'::public.job_status THEN
    UPDATE public.jobs
    SET status = 'quote_sent'::public.job_status
    WHERE id = NEW.job_id
      AND status = 'new'::public.job_status;
  ELSIF NEW.status = 'accepted'::public.quote_status THEN
    UPDATE public.jobs
    SET status = 'accepted'::public.job_status
    WHERE id = NEW.job_id
      AND status IS DISTINCT FROM 'accepted'::public.job_status;
  ELSIF NEW.status = 'rejected'::public.quote_status THEN
    UPDATE public.jobs
    SET status = 'canceled'::public.job_status
    WHERE id = NEW.job_id
      AND status IS DISTINCT FROM 'canceled'::public.job_status;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_quotes_assign_sequence ON public.quotes;
CREATE TRIGGER trg_quotes_assign_sequence
BEFORE INSERT ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.assign_quote_sequence_fields();

DROP TRIGGER IF EXISTS trg_quotes_set_updated_at ON public.quotes;
CREATE TRIGGER trg_quotes_set_updated_at
BEFORE UPDATE ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_quotes_sync_job_status ON public.quotes;
CREATE TRIGGER trg_quotes_sync_job_status
AFTER UPDATE OF status ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_status_from_quote();

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotes_select ON public.quotes;
CREATE POLICY quotes_select ON public.quotes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = quotes.job_id));

DROP POLICY IF EXISTS quotes_insert ON public.quotes;
CREATE POLICY quotes_insert ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = quotes.job_id));

DROP POLICY IF EXISTS quotes_update ON public.quotes;
CREATE POLICY quotes_update ON public.quotes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = quotes.job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = quotes.job_id));

DROP POLICY IF EXISTS quote_lines_select ON public.quote_lines;
CREATE POLICY quote_lines_select ON public.quote_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quotes q
      JOIN public.jobs j ON j.id = q.job_id
      WHERE q.id = quote_lines.quote_id
    )
  );

DROP POLICY IF EXISTS quote_lines_insert ON public.quote_lines;
CREATE POLICY quote_lines_insert ON public.quote_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.quotes q
      JOIN public.jobs j ON j.id = q.job_id
      WHERE q.id = quote_lines.quote_id
    )
  );

DROP POLICY IF EXISTS quote_lines_update ON public.quote_lines;
CREATE POLICY quote_lines_update ON public.quote_lines
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quotes q
      JOIN public.jobs j ON j.id = q.job_id
      WHERE q.id = quote_lines.quote_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.quotes q
      JOIN public.jobs j ON j.id = q.job_id
      WHERE q.id = quote_lines.quote_id
    )
  );
