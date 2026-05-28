-- `20260425173000_role_matrix_rls_reset` je DROP-ovao sve politike na `work_orders`, uključujući
-- `work_orders_insert_automation_unassigned` iz `20260422191000`, i nije je ponovo kreirao.
-- Bez nje nabavka/proizvodnja ne mogu INSERT (RLS) novog RN ugradnje iz `invoice_missing_part_secure_core`
-- i dugmeta „Zaboravljeno u magacinu — Zakaži do-ugradnju“.

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
