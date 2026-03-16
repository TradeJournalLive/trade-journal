insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-media',
  'trade-media',
  true,
  4194304,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "trade_media_insert_own" on storage.objects;
create policy "trade_media_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trade-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "trade_media_update_own" on storage.objects;
create policy "trade_media_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trade-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'trade-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "trade_media_delete_own" on storage.objects;
create policy "trade_media_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trade-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "trade_media_select_public" on storage.objects;
create policy "trade_media_select_public"
on storage.objects
for select
to public
using (bucket_id = 'trade-media');
