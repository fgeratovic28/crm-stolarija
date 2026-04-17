-- 12. VEHICLES table
-- Administracija vozila (vozila, registracija, servis, zaduženi radnik/vozač).

-- Enum statusa vozila
CREATE TYPE vehicle_status AS ENUM ('active', 'in_service', 'archived');

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_name TEXT NOT NULL,
  registration_number TEXT,
  brand_model TEXT,
  status vehicle_status NOT NULL DEFAULT 'active',
  registration_date DATE,
  expiration_date DATE,
  service_notes TEXT,
  assigned_worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
  general_notes TEXT,
  last_service_date DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES: admin + procurement imaju puni pristup
CREATE POLICY admin_all_vehicles ON vehicles FOR ALL TO authenticated
  USING (get_current_user_role() = 'admin');

CREATE POLICY procurement_all_vehicles ON vehicles FOR ALL TO authenticated
  USING (get_current_user_role() = 'procurement');

-- Indexes
CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_assigned_worker ON vehicles(assigned_worker_id);
CREATE INDEX idx_vehicles_created_at ON vehicles(created_at);

