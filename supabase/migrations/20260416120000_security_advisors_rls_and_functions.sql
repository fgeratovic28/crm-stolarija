-- Security advisors: RLS on counter tables, tighten app_settings policies, pin search_path on public functions.

-- 1) Number generators must bypass RLS on internal counter rows (invoker would be blocked once RLS is on).
ALTER FUNCTION public.next_job_number(text, integer) SECURITY DEFINER;
ALTER FUNCTION public.next_job_number(text, integer) SET search_path TO public;

ALTER FUNCTION public.next_customer_number(text, integer) SECURITY DEFINER;
ALTER FUNCTION public.next_customer_number(text, integer) SET search_path TO public;

ALTER FUNCTION public.next_customer_number(text) SET search_path TO public;

-- 2) Helper used by RLS policies — pin search_path before policy changes below.
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
  SELECT role FROM public.users WHERE id = auth.uid();
$func$;

-- 3) Enable RLS (no policies: direct API access denied; generators above run as definer and bypass RLS.)
ALTER TABLE public.job_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_number_counters ENABLE ROW LEVEL SECURITY;

-- 4) app_settings: only admin/office may change company-wide settings (not any authenticated user).
DROP POLICY IF EXISTS app_settings_update_authenticated ON public.app_settings;
DROP POLICY IF EXISTS app_settings_insert_authenticated ON public.app_settings;

CREATE POLICY app_settings_update_office_admin ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_current_user_role() IN ('admin', 'office') AND id = 1);

CREATE POLICY app_settings_insert_office_admin ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (id = 1 AND public.get_current_user_role() IN ('admin', 'office'));

-- 5) Pin search_path on remaining flagged functions.
ALTER FUNCTION public.set_updated_at() SET search_path TO public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'name', 'Korisnik'), 'office');
  RETURN new;
END;
$func$;

CREATE OR REPLACE FUNCTION public.prevent_field_team_work_order_content_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF public.get_current_user_role() IN ('montaza', 'teren') THEN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.date IS DISTINCT FROM OLD.date
      OR NEW.team_id IS DISTINCT FROM OLD.team_id
      OR NEW.file_id IS DISTINCT FROM OLD.file_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Timske uloge ne mogu menjati detalje radnog naloga.';
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.require_field_report_before_finishing_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
  has_valid_report boolean;
BEGIN
  v_role := public.get_current_user_role();

  IF v_role IN ('montaza', 'teren')
     AND NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.field_reports fr
      WHERE fr.work_order_id = NEW.id
        AND COALESCE(array_length(fr.images, 1), 0) > 0
        AND COALESCE(BTRIM(fr.general_report), '') <> ''
        AND (
          NEW.status = 'canceled'
          OR COALESCE(BTRIM(fr.measurements), '') <> ''
        )
    ) INTO has_valid_report;

    IF NOT has_valid_report THEN
      RAISE EXCEPTION 'Nalog ne može biti završen bez popunjenog izveštaja (slika + izveštaj + mere).';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;
