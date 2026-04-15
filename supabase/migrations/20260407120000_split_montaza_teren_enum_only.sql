-- KORAK 1 (mora biti posebna migracija / posebna transakcija):
-- Nove vrednosti enum-a moraju biti commit-ovane pre upotrebe u UPDATE ili polisama.
-- Supabase primenjuje jednu migraciju po fajlu u zasebnoj transakciji — ovaj fajl sadrži samo ADD VALUE.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'montaza';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'teren';

ALTER TYPE work_order_type ADD VALUE IF NOT EXISTS 'site_visit';
ALTER TYPE work_order_type ADD VALUE IF NOT EXISTS 'control_visit';
