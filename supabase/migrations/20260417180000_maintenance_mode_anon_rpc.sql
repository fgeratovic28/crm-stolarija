-- Omogući proveru režima održavanja na stranici za prijavu (anon) kada je aplikacija potpuno blokirana.

GRANT EXECUTE ON FUNCTION public.get_maintenance_mode() TO anon;
