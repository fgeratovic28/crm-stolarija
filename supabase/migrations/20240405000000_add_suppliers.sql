-- 11. SUPPLIERS table
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    material_types material_type[] DEFAULT '{}',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update material_orders table to reference suppliers
ALTER TABLE material_orders ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE material_orders ADD COLUMN supplier_contact TEXT;
ALTER TABLE material_orders ADD COLUMN expected_delivery_date DATE;
ALTER TABLE material_orders ADD COLUMN notes TEXT;
ALTER TABLE material_orders ADD COLUMN request_file TEXT;
ALTER TABLE material_orders ADD COLUMN quote_file TEXT;

-- ENABLE RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES for suppliers
CREATE POLICY admin_all_suppliers ON suppliers FOR ALL TO authenticated USING (get_current_user_role() = 'admin');
CREATE POLICY procurement_all_suppliers ON suppliers FOR ALL TO authenticated USING (get_current_user_role() = 'procurement');
CREATE POLICY office_read_suppliers ON suppliers FOR SELECT TO authenticated USING (get_current_user_role() = 'office');
CREATE POLICY production_read_suppliers ON suppliers FOR SELECT TO authenticated USING (get_current_user_role() = 'production');

-- INDEXES
CREATE INDEX idx_material_orders_supplier ON material_orders(supplier_id);
CREATE INDEX idx_suppliers_name ON suppliers(name);
