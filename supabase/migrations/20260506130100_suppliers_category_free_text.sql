-- Allow custom supplier categories entered from UI.
-- Previous migration added a CHECK constraint limited to fixed values.
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_category_check;

-- Keep default for convenience when field is omitted.
ALTER TABLE suppliers ALTER COLUMN category SET DEFAULT 'Ostalo';
