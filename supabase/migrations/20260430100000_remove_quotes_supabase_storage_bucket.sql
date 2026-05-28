-- Uklanjanje RLS politika za bucket „quotes” (ponude su na R2).
-- Napomena: Supabase ne dozvoljava DELETE na storage.objects / storage.buckets iz SQL-a
-- (storage.protect_delete). Fajlove i bucket obriši ručno: Dashboard → Storage → bucket „quotes” → Empty → Delete bucket.

DROP POLICY IF EXISTS quotes_storage_insert ON storage.objects;
DROP POLICY IF EXISTS quotes_storage_select ON storage.objects;
DROP POLICY IF EXISTS quotes_storage_update ON storage.objects;
DROP POLICY IF EXISTS quotes_storage_delete ON storage.objects;
