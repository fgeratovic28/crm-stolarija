-- Timske uloge (montaza/teren) ne smeju da menjaju sadržaj radnog naloga:
-- dozvoljeno je samo čitanje i promena statusa na postojećem nalogu svog tima.

DROP POLICY IF EXISTS montaza_work_orders ON public.work_orders;
DROP POLICY IF EXISTS teren_work_orders ON public.work_orders;

CREATE POLICY montaza_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type = 'installation'
  );

CREATE POLICY montaza_work_orders_update_status ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type = 'installation'
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type = 'installation'
  );

CREATE POLICY teren_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  );

CREATE POLICY teren_work_orders_update_status ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_field_team_work_order_content_update()
RETURNS trigger AS $$
BEGIN
  IF get_current_user_role() IN ('montaza', 'teren') THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_field_team_work_order_content_update ON public.work_orders;
CREATE TRIGGER trg_prevent_field_team_work_order_content_update
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_field_team_work_order_content_update();
