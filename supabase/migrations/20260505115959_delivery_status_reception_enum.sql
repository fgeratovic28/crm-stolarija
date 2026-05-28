-- Nova vrednosti enum-a moraju biti u posebnoj migraciji (commit pre upotrebe u funkcijama/tabelama).

ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'materials_received';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'received_with_issues';
