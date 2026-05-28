-- Jedan odgovor za sivi baner na kontrolnoj tabli (RN bez tima + prihvaćeno/merenje bez kompletnog zakazivanja).
-- Izbegava više klijentskih upita / embed i slučajeve gde PostgREST vrati neočekivan oblik.

CREATE OR REPLACE FUNCTION public.get_dashboard_unscheduled_work_orders_json()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
  SELECT jsonb_build_object(
    'missing_team_rows',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(m))
        FROM public.list_work_orders_missing_team_for_dashboard() AS m
      ),
      '[]'::jsonb
    ),
    'accepted_measurement_rows',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(a))
        FROM public.list_accepted_needs_measurement_schedule_for_dashboard() AS a
      ),
      '[]'::jsonb
    )
  );
$func$;

ALTER FUNCTION public.get_dashboard_unscheduled_work_orders_json() SET search_path TO public;

COMMENT ON FUNCTION public.get_dashboard_unscheduled_work_orders_json() IS
  'Kontrolna tabla: JSON sa missing_team_rows i accepted_measurement_rows (isti izvor kao postojeći RPC-ovi).';

REVOKE ALL ON FUNCTION public.get_dashboard_unscheduled_work_orders_json() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_unscheduled_work_orders_json() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_unscheduled_work_orders_json() TO service_role;

NOTIFY pgrst, 'reload schema';
