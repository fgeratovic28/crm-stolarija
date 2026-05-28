-- Posle otpreme priloga uz narudžbinu (RPC register_material_order_supplier_file), klijent poziva
-- upsertSystemActivity sa system_key 'file-uploaded:<files.id>'. Uloga production ima INSERT/SELECT
-- na activities samo za poslove sa sopstvenim production radnim nalogom — magacin pri prijemu
-- materijala često nema taj uslov, pa INSERT pada na RLS.

DROP POLICY IF EXISTS production_activities_select ON public.activities;
CREATE POLICY production_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND (
      job_id IN (
        SELECT wo.job_id
        FROM public.work_orders wo
        WHERE wo.type = 'production'
          AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
      )
      OR (
        system_key IS NOT NULL
        AND system_key LIKE 'file-uploaded:%'
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.job_id = activities.job_id
        )
      )
    )
  );

DROP POLICY IF EXISTS production_activities_insert ON public.activities;
CREATE POLICY production_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'production'::public.user_role
    AND (
      job_id IN (
        SELECT wo.job_id
        FROM public.work_orders wo
        WHERE wo.type = 'production'
          AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
      )
      OR (
        system_key IS NOT NULL
        AND system_key LIKE 'file-uploaded:%'
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.job_id = activities.job_id
        )
      )
    )
  );

DROP POLICY IF EXISTS production_activities_update ON public.activities;
CREATE POLICY production_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND (
      job_id IN (
        SELECT wo.job_id
        FROM public.work_orders wo
        WHERE wo.type = 'production'
          AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
      )
      OR (
        system_key IS NOT NULL
        AND system_key LIKE 'file-uploaded:%'
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.job_id = activities.job_id
        )
      )
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'production'::public.user_role
    AND (
      job_id IN (
        SELECT wo.job_id
        FROM public.work_orders wo
        WHERE wo.type = 'production'
          AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
      )
      OR (
        system_key IS NOT NULL
        AND system_key LIKE 'file-uploaded:%'
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.job_id = activities.job_id
        )
      )
    )
  );

COMMENT ON POLICY production_activities_insert ON public.activities IS
  'Production: uobičajeno preko production RN tima; dodatno INSERT za [AUTO] fajl narudžbine (system_key file-uploaded:*) kad posao ima material_orders.';
