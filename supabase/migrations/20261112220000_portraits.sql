-- Pictures for heroes and enemies.
-- The row keeps the storage path (plus ?v=... so a new upload shows at once).
-- Files live in the public bucket `portraits` as <campaign id>/hero-<character id>.jpg
-- and <campaign id>/enemy-<name>.jpg. Anyone with the link can view a picture;
-- only the GM, or the player who holds that hero, can add or change one.

alter table public.characters add column if not exists portrait text;
alter table public.enemies    add column if not exists portrait text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Who may write a file: the campaign's GM, or the holder of the hero the file is named for.
create or replace function private.can_write_portrait(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  cid uuid;
  fname text := storage.filename(object_name);
begin
  begin
    cid := ((storage.foldername(object_name))[1])::uuid;
  exception when others then
    return false;
  end;
  if private.is_gm(cid) then return true; end if;
  if fname like 'hero-%' then
    begin
      return private.owns_character(cid, (substring(fname from 6 for 36))::uuid);
    exception when others then
      return false;
    end;
  end if;
  return false;
end $$;

create or replace function private.can_list_portraits(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return private.is_member(((storage.foldername(object_name))[1])::uuid);
exception when others then
  return false;
end $$;

grant execute on function private.can_write_portrait(text), private.can_list_portraits(text) to authenticated;

create policy portraits_member_list on storage.objects for select to authenticated
  using (bucket_id = 'portraits' and private.can_list_portraits(name));
create policy portraits_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'portraits' and private.can_write_portrait(name));
create policy portraits_update on storage.objects for update to authenticated
  using (bucket_id = 'portraits' and private.can_write_portrait(name))
  with check (bucket_id = 'portraits' and private.can_write_portrait(name));
create policy portraits_delete on storage.objects for delete to authenticated
  using (bucket_id = 'portraits' and private.can_write_portrait(name));
