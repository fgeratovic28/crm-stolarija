-- KORAK 2: Pokreće se nakon što je migracija sa ADD VALUE uspešno primenjena.

-- Postojeći korisnici sa installation → podrazumevano Montaža (admin može prebaciti na Teren)
UPDATE public.users SET role = 'montaza'::user_role WHERE role = 'installation'::user_role;

DROP POLICY IF EXISTS installation_work_orders ON work_orders;
DROP POLICY IF EXISTS installation_field_reports ON field_reports;
DROP POLICY IF EXISTS installation_read_jobs ON jobs;
DROP POLICY IF EXISTS installation_read_files ON files;
DROP POLICY IF EXISTS installation_read_customers ON customers;

CREATE POLICY montaza_work_orders ON work_orders
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
    AND type = 'installation'
  );

CREATE POLICY montaza_field_reports ON field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND work_order_id IN (
      SELECT id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY montaza_read_jobs ON jobs
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY montaza_read_customers ON customers
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND id IN (
      SELECT customer_id FROM jobs
      WHERE id IN (
        SELECT job_id FROM work_orders
        WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
          AND type = 'installation'
      )
    )
  );

CREATE POLICY montaza_read_files ON files
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY teren_work_orders ON work_orders
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  );

CREATE POLICY teren_field_reports ON field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND work_order_id IN (
      SELECT id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );

CREATE POLICY teren_read_jobs ON jobs
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );

CREATE POLICY teren_read_customers ON customers
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND id IN (
      SELECT customer_id FROM jobs
      WHERE id IN (
        SELECT job_id FROM work_orders
        WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
          AND type IN (
            'measurement',
            'measurement_verification',
            'complaint',
            'service',
            'site_visit',
            'control_visit'
          )
      )
    )
  );

CREATE POLICY teren_read_files ON files
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM work_orders
      WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );
