-- OBAVEZNO: POKRENITE OVAJ FAJL IZ DVA POSEBNA KORAKA U SQL EDITORU

-- ==========================================
-- KORAK 1: Dodavanje nove uloge u ENUM
-- (Ovo mora biti izvršeno i potvrđeno pre KORAKA 2)
-- ==========================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'production';

-- ==========================================
-- KORAK 2: Ažuriranje podataka i RLS polisa
-- (Pokrenite ovo tek nakon što je KORAK 1 uspešno završen)
-- ==========================================

-- 1. MIGRACIJA KORISNIKA
-- Pošto se 'service' spaja sa 'installation', migriramo sve korisnike
UPDATE users SET role = 'installation' WHERE role = 'service';

-- 2. RESETOVANJE POSTOJEĆIH POLISA
DROP POLICY IF EXISTS office_customers ON customers;
DROP POLICY IF EXISTS office_jobs ON jobs;
DROP POLICY IF EXISTS office_activities ON activities;
DROP POLICY IF EXISTS office_files ON files;
DROP POLICY IF EXISTS office_read_teams ON teams;
DROP POLICY IF EXISTS office_read_users ON users;
DROP POLICY IF EXISTS office_read_all ON teams;

DROP POLICY IF EXISTS finance_payments ON payments;
DROP POLICY IF EXISTS finance_read_jobs ON jobs;
DROP POLICY IF EXISTS finance_read_customers ON customers;
DROP POLICY IF EXISTS finance_files ON files;

DROP POLICY IF EXISTS procurement_orders ON material_orders;
DROP POLICY IF EXISTS procurement_read_jobs ON jobs;
DROP POLICY IF EXISTS procurement_files ON files;
DROP POLICY IF EXISTS procurement_all_suppliers ON suppliers;

DROP POLICY IF EXISTS production_work_orders ON work_orders;
DROP POLICY IF EXISTS production_read_jobs ON jobs;
DROP POLICY IF EXISTS production_files ON files;
DROP POLICY IF EXISTS production_read_suppliers ON suppliers;

DROP POLICY IF EXISTS installation_work_orders ON work_orders;
DROP POLICY IF EXISTS installation_field_reports ON field_reports;
DROP POLICY IF EXISTS installation_read_jobs ON jobs;
DROP POLICY IF EXISTS installation_read_files ON files;
DROP POLICY IF EXISTS installation_read_customers ON customers;

DROP POLICY IF EXISTS service_work_orders ON work_orders;
DROP POLICY IF EXISTS service_field_reports ON field_reports;
DROP POLICY IF EXISTS service_read_jobs ON jobs;
DROP POLICY IF EXISTS service_read_files ON files;

-- 3. PRIMENA NOVIH POLISA

-- Kancelarija/Prodaja (office)
CREATE POLICY office_customers ON customers FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_jobs ON jobs FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_activities ON activities FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_read_teams ON teams FOR SELECT TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_read_users ON users FOR SELECT TO authenticated USING (get_current_user_role() = 'office');

-- Finansije (finance)
CREATE POLICY finance_payments ON payments FOR ALL TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_read_customers ON customers FOR SELECT TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'finance' AND category = 'finance');

-- Nabavka (procurement)
CREATE POLICY procurement_orders ON material_orders FOR ALL TO authenticated USING (get_current_user_role() = 'procurement');
CREATE POLICY procurement_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'procurement');
CREATE POLICY procurement_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'procurement' AND category = 'supplier');
CREATE POLICY procurement_all_suppliers ON suppliers FOR ALL TO authenticated USING (get_current_user_role() = 'procurement');

-- Proizvodnja (production)
CREATE POLICY production_work_orders ON work_orders 
    FOR ALL TO authenticated 
    USING (
        get_current_user_role() = 'production' AND 
        (type = 'production' OR type = 'measurement' OR type = 'measurement_verification')
    );
CREATE POLICY production_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'production');
CREATE POLICY production_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'production' AND category = 'work_order');
CREATE POLICY production_read_suppliers ON suppliers FOR SELECT TO authenticated USING (get_current_user_role() = 'production');

-- Montaža/Teren (installation)
CREATE POLICY installation_work_orders ON work_orders 
    FOR ALL TO authenticated 
    USING (
        get_current_user_role() = 'installation' AND 
        team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
    );

CREATE POLICY installation_field_reports ON field_reports 
    FOR ALL TO authenticated 
    USING (
        get_current_user_role() = 'installation' AND 
        work_order_id IN (
            SELECT id FROM work_orders 
            WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid())
        )
    );

CREATE POLICY installation_read_jobs ON jobs FOR SELECT TO authenticated 
    USING (
        get_current_user_role() = 'installation' AND 
        id IN (SELECT job_id FROM work_orders WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid()))
    );

CREATE POLICY installation_read_customers ON customers FOR SELECT TO authenticated 
    USING (
        get_current_user_role() = 'installation' AND 
        id IN (
            SELECT customer_id FROM jobs 
            WHERE id IN (SELECT job_id FROM work_orders WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid()))
        )
    );

CREATE POLICY installation_read_files ON files FOR SELECT TO authenticated 
    USING (
        get_current_user_role() = 'installation' AND 
        job_id IN (SELECT job_id FROM work_orders WHERE team_id IN (SELECT team_id FROM users WHERE id = auth.uid()))
    );
