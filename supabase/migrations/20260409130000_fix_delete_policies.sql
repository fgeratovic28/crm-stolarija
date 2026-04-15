-- Fix DELETE support in RLS policies (FOR ALL now properly handles all operations)

DROP POLICY IF EXISTS office_customers ON customers;
DROP POLICY IF EXISTS office_jobs ON jobs;
DROP POLICY IF EXISTS office_activities ON activities;
DROP POLICY IF EXISTS office_files ON files;

-- Office: full access (CREATE, READ, UPDATE, DELETE) on customers, jobs, activities, files
CREATE POLICY office_customers ON customers FOR ALL TO authenticated 
  USING (get_current_user_role() = 'office')
  WITH CHECK (get_current_user_role() = 'office');

CREATE POLICY office_jobs ON jobs FOR ALL TO authenticated 
  USING (get_current_user_role() = 'office')
  WITH CHECK (get_current_user_role() = 'office');

CREATE POLICY office_activities ON activities FOR ALL TO authenticated 
  USING (get_current_user_role() = 'office')
  WITH CHECK (get_current_user_role() = 'office');

CREATE POLICY office_files ON files FOR ALL TO authenticated 
  USING (get_current_user_role() = 'office')
  WITH CHECK (get_current_user_role() = 'office');

-- Admin can do anything
DROP POLICY IF EXISTS admin_all_customers ON customers;
DROP POLICY IF EXISTS admin_all_jobs ON jobs;

CREATE POLICY admin_all_customers ON customers FOR ALL TO authenticated 
  USING (get_current_user_role() = 'admin')
  WITH CHECK (get_current_user_role() = 'admin');

CREATE POLICY admin_all_jobs ON jobs FOR ALL TO authenticated 
  USING (get_current_user_role() = 'admin')
  WITH CHECK (get_current_user_role() = 'admin');
