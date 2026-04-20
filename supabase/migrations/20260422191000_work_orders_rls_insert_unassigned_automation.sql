-- ensure_workflow_work_orders radi INSERT sa team_id NULL iz sesije pozivaoca (npr. teren).
-- Postojeće politike: teren/montaža/proizvodnja imaju samo SELECT/UPDATE uz team_id = tim korisnika;
-- INSERT uopšte nije dozvoljen terenu, a office/admin imaju posebne politike.
-- Bez ove politike INSERT automatskog RN pada na RLS (čak i iz SECURITY DEFINER RPC — RLS za sesiju).

DROP POLICY IF EXISTS work_orders_insert_automation_unassigned ON public.work_orders;

CREATE POLICY work_orders_insert_automation_unassigned ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    team_id IS NULL
    AND status = 'pending'::public.work_order_status
    AND type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type,
      'production'::public.work_order_type,
      'installation'::public.work_order_type
    )
  );
