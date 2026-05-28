-- Add category field to suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Ostalo' CHECK (category IN ('Profili', 'Staklo', 'Okov', 'Roletne/Kupovno', 'Ostalo'));

-- Add comment for documentation
COMMENT ON COLUMN suppliers.category IS 'Category/type of supplier: Profili, Staklo, Okov, Roletne/Kupovno, Ostalo';
