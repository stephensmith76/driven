-- The bank: a private, shared store of heroes and villains that can be copied
-- into any campaign linked to it.
--
-- A bank has a name, a short code and its own passcode (like a campaign).
-- A campaign's GM links the campaign to a bank by entering the code and
-- passcode once. After that, every GM of that campaign can read and write the
-- bank. Entries are copies: adding one to a campaign makes a separate row
-- there, and nothing in a campaign changes the bank until the GM saves again.

create table public.banks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table private.bank_keys (
  bank_id       uuid primary key references public.banks(id) on delete cascade,
  passcode_hash text not null
);

-- One bank per campaign. Rows are only created by the RPCs below.
create table public.campaign_banks (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  bank_id     uuid not null references public.banks(id) on delete cascade,
  linked_at   timestamptz not null default now()
);
create index on public.campaign_banks (bank_id);

create table public.bank_entries (
  id         uuid primary key default gen_random_uuid(),
  bank_id    uuid not null references public.banks(id) on delete cascade,
  kind       text not null check (kind in ('hero', 'enemy')),
  name       text not null,
  -- hero:  civilian, archetype_id, trait_id, stats, flair_ids, loadout, extra_slots, connections
  -- enemy: kind, stats, defenses, toughness, harm_max, count_max, drive, line, source_id
  data       jsonb not null default '{}'::jsonb,
  portrait   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.bank_entries (bank_id, kind);
create trigger touch_updated_at before update on public.bank_entries
  for each row execute function private.touch_updated_at();

-- A device may use a bank if it is the GM of a campaign linked to it.
create or replace function private.can_use_bank(bid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaign_banks cb
                 where cb.bank_id = bid and private.is_gm(cb.campaign_id));
$$;
revoke all on function private.can_use_bank(uuid) from public;
grant execute on function private.can_use_bank(uuid) to authenticated;

alter table public.banks          enable row level security;
alter table public.campaign_banks enable row level security;
alter table public.bank_entries   enable row level security;

create policy banks_read on public.banks for select to authenticated
  using (private.can_use_bank(id));
create policy campaign_banks_gm_read on public.campaign_banks for select to authenticated
  using (private.is_gm(campaign_id));
create policy campaign_banks_gm_delete on public.campaign_banks for delete to authenticated
  using (private.is_gm(campaign_id));
create policy bank_entries_use on public.bank_entries for all to authenticated
  using (private.can_use_bank(bank_id)) with check (private.can_use_bank(bank_id));

create or replace function private.new_bank_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.banks b where b.code = c);
  end loop;
  return c;
end $$;
revoke all on function private.new_bank_code() from public;

-- Start a new bank and link this campaign to it. GM only.
create or replace function public.create_bank(p_campaign_id uuid, p_name text, p_passcode text)
returns table (new_bank_id uuid, new_code text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  bid uuid;
  c text;
begin
  if not private.is_gm(p_campaign_id) then raise exception 'GM only' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Give the bank a name' using errcode = '22023';
  end if;
  if p_passcode is null or char_length(p_passcode) < 4 then
    raise exception 'Passcode must be at least 4 characters' using errcode = '22023';
  end if;
  c := private.new_bank_code();
  insert into public.banks (name, code) values (trim(p_name), c) returning id into bid;
  insert into private.bank_keys (bank_id, passcode_hash)
    values (bid, extensions.crypt(p_passcode, extensions.gen_salt('bf', 8)));
  insert into public.campaign_banks (campaign_id, bank_id) values (p_campaign_id, bid)
    on conflict (campaign_id) do update set bank_id = excluded.bank_id, linked_at = now();
  return query select bid, c;
end $$;

-- Link this campaign to an existing bank with its code and passcode. GM only.
create or replace function public.link_bank(p_campaign_id uuid, p_code text, p_passcode text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  bid uuid;
  hash text;
begin
  if not private.is_gm(p_campaign_id) then raise exception 'GM only' using errcode = '42501'; end if;
  select b.id into bid from public.banks b where b.code = upper(trim(p_code));
  if bid is null then raise exception 'Wrong bank code or passcode' using errcode = '28P01'; end if;
  select k.passcode_hash into hash from private.bank_keys k where k.bank_id = bid;
  if hash is null or extensions.crypt(p_passcode, hash) <> hash then
    raise exception 'Wrong bank code or passcode' using errcode = '28P01';
  end if;
  insert into public.campaign_banks (campaign_id, bank_id) values (p_campaign_id, bid)
    on conflict (campaign_id) do update set bank_id = excluded.bank_id, linked_at = now();
  return bid;
end $$;

-- Pictures for bank entries live in the same public bucket, under <bank id>/entry-<entry id>.jpg.
-- Replace the two portrait checks so a bank's users can write and list its folder too.
create or replace function private.can_write_portrait(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder uuid;
  fname text := storage.filename(object_name);
begin
  begin
    folder := ((storage.foldername(object_name))[1])::uuid;
  exception when others then
    return false;
  end;
  if private.is_gm(folder) or private.can_use_bank(folder) then return true; end if;
  if fname like 'hero-%' then
    begin
      return private.owns_character(folder, (substring(fname from 6 for 36))::uuid);
    exception when others then
      return false;
    end;
  end if;
  return false;
end $$;

create or replace function private.can_list_portraits(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder uuid;
begin
  folder := ((storage.foldername(object_name))[1])::uuid;
  return private.is_member(folder) or private.can_use_bank(folder);
exception when others then
  return false;
end $$;
