-- Create custom types for the CRM
CREATE TYPE user_role AS ENUM ('admin', 'office', 'finance', 'procurement', 'production', 'installation');
CREATE TYPE job_status AS ENUM ('new', 'active', 'in_progress', 'waiting_materials', 'scheduled', 'completed', 'complaint', 'service');
CREATE TYPE communication_type AS ENUM ('email', 'phone', 'in_person', 'viber', 'other');
CREATE TYPE work_order_type AS ENUM ('measurement', 'measurement_verification', 'installation', 'complaint', 'service', 'production');
CREATE TYPE material_type AS ENUM ('glass', 'mosquito_net', 'profile', 'shutters', 'sills', 'boards', 'hardware', 'sealant', 'other');
CREATE TYPE file_category AS ENUM ('offers', 'communication', 'finance', 'supplier', 'work_order', 'field_photos', 'reports');
CREATE TYPE work_order_status AS ENUM ('pending', 'in_progress', 'completed', 'canceled');
CREATE TYPE delivery_status AS ENUM ('pending', 'shipped', 'delivered', 'partial');

-- 1. TEAMS table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS table (linked to auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role user_role NOT NULL DEFAULT 'office',
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. CUSTOMERS table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    billing_address TEXT,
    installation_address TEXT,
    phones TEXT[] DEFAULT '{}',
    emails TEXT[] DEFAULT '{}',
    pib TEXT,
    registration_number TEXT,
    contact_person TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. JOBS table
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    job_number TEXT UNIQUE NOT NULL,
    status job_status NOT NULL DEFAULT 'new',
    summary TEXT,
    billing_address TEXT,
    installation_address TEXT,
    customer_phone TEXT,
    total_price DECIMAL(12, 2) DEFAULT 0,
    vat_amount DECIMAL(12, 2) DEFAULT 0,
    advance_payment DECIMAL(12, 2) DEFAULT 0,
    scheduled_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. FILES table (created before other tables that reference it)
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    category file_category NOT NULL,
    filename TEXT NOT NULL,
    size TEXT,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. ACTIVITIES table
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    type communication_type NOT NULL,
    description TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL
);

-- 7. PAYMENTS table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    vat_included BOOLEAN DEFAULT TRUE,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. MATERIAL_ORDERS table
CREATE TABLE material_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    supplier TEXT,
    material_type material_type NOT NULL,
    request_date DATE DEFAULT CURRENT_DATE,
    delivery_date DATE,
    supplier_price DECIMAL(12, 2) DEFAULT 0,
    paid BOOLEAN DEFAULT FALSE,
    barcode TEXT,
    request_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    quote_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    delivered_ok BOOLEAN DEFAULT FALSE,
    delivery_status delivery_status DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. WORK_ORDERS table
CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    type work_order_type NOT NULL,
    description TEXT,
    date DATE,
    status work_order_status NOT NULL DEFAULT 'pending',
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. FIELD_REPORTS table
CREATE TABLE field_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    arrived BOOLEAN DEFAULT FALSE,
    arrival_datetime TIMESTAMP WITH TIME ZONE,
    completed BOOLEAN DEFAULT FALSE,
    everything_ok BOOLEAN DEFAULT TRUE,
    issues TEXT,
    handover_date DATE,
    images TEXT[] DEFAULT '{}',
    missing_items TEXT[] DEFAULT '{}',
    additional_needs TEXT[] DEFAULT '{}',
    measurements TEXT,
    general_report TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_activities_job ON activities(job_id);
CREATE INDEX idx_payments_job ON payments(job_id);
CREATE INDEX idx_material_orders_job ON material_orders(job_id);
CREATE INDEX idx_work_orders_job ON work_orders(job_id);
CREATE INDEX idx_work_orders_team ON work_orders(team_id);
CREATE INDEX idx_field_reports_work_order ON field_reports(work_order_id);
CREATE INDEX idx_files_job ON files(job_id);

-- ENABLE RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
    SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. Administrator: full access to everything
CREATE POLICY admin_all_teams ON teams FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_users ON users FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_customers ON customers FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_jobs ON jobs FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_activities ON activities FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_payments ON payments FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_material_orders ON material_orders FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_work_orders ON work_orders FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_field_reports ON field_reports FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY admin_all_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'admin');

-- 2. Kancelarija/Prodaja (office): customers, jobs, activities, files
CREATE POLICY office_customers ON customers FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_jobs ON jobs FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_activities ON activities FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_read_teams ON teams FOR SELECT TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY office_read_users ON users FOR SELECT TO authenticated USING (get_current_user_role() = 'office');

-- 3. Finansije (finance): payments, read customers/jobs, files (finance category)
CREATE POLICY finance_payments ON payments FOR ALL TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_read_customers ON customers FOR SELECT TO authenticated USING (get_current_user_role() = 'finance');
CREATE POLICY finance_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'finance' AND category = 'finance');

-- 4. Nabavka (procurement): material_orders, read jobs, files (supplier category)
CREATE POLICY procurement_orders ON material_orders FOR ALL TO authenticated USING (get_current_user_role() = 'procurement');
CREATE POLICY procurement_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'procurement');
CREATE POLICY procurement_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'procurement' AND category = 'supplier');

-- 5. Proizvodnja (production): work_orders (production/measurement type), read jobs, files (work_order category)
CREATE POLICY production_work_orders ON work_orders 
    FOR ALL TO authenticated 
    USING (
        get_current_user_role() = 'production' AND 
        (type = 'production' OR type = 'measurement' OR type = 'measurement_verification')
    );
CREATE POLICY production_read_jobs ON jobs FOR SELECT TO authenticated USING (get_current_user_role() = 'production');
CREATE POLICY production_files ON files FOR ALL TO authenticated USING (get_current_user_role() = 'production' AND category = 'work_order');

-- 6. Montaža/Teren (installation): work_orders (only own team), field_reports (only own team)
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

-- DEFAULT USER PROFILE TRIGGER
-- This function will automatically create a user profile in public.users when a user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'name', 'Korisnik'), 'office');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
