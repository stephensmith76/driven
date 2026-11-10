-- Street Level companion app: M0 foundation.
-- Tables, row-level security, realtime, and the membership RPCs.
-- See SPEC.md "Data model" and "Access, roles and secrets".
--
-- Access model in one paragraph: every device is an anonymous Supabase user
-- (role `authenticated`). Being signed in grants nothing. A device can see a
-- campaign only through a `members` row, and only the security-definer RPCs
-- below create or change `members` rows. GM-only data checks role = 'gm'.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- helpers

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- tables

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  join_code     text not null unique,
  rules_version text,
  night         int  not null default 1,
  phase         text not null default 'patrol'
                check (phase in ('patrol', 'crack', 'confrontation', 'dawn')),
  settings      jsonb not null default
                '{"players_can_build": true, "players_see_sheets": true}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The GM passcode hash. SPEC.md lists it as campaigns.gm_code_hash; it lives
-- in an unexposed schema instead so no player, query or realtime event can
-- ever carry it (principle 3).
create table private.campaign_keys (
  campaign_id  uuid primary key references public.campaigns(id) on delete cascade,
  gm_code_hash text not null
);

create table public.characters (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  name         text not null default 'New hero',
  civilian     text not null default '',
  archetype_id text,
  trait_id     text,
  stats        jsonb not null default '{"force": 0, "flow": 0, "focus": 0, "presence": 0}'::jsonb,
  flair_ids    text[] not null default '{}',
  loadout      jsonb not null default '[]'::jsonb,
  harm         int not null default 0,
  stress       int not null default 0,
  drive        int not null default 2,
  dying        boolean not null default false,
  hidden       boolean not null default false,
  home_clock   int not null default 0,
  fight_state  jsonb not null default '{}'::jsonb,
  notes        text not null default '',
  is_npc       boolean not null default false,
  locked       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.characters (campaign_id);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('player', 'gm')),
  character_id uuid references public.characters(id) on delete set null,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create index on public.members (user_id);
create index on public.members (character_id);

create table public.clocks (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  name               text not null,
  kind               text not null default 'custom'
                     check (kind in ('scheme', 'heat', 'goal', 'endgame', 'custom')),
  size               int not null default 6 check (size between 1 and 20),
  filled             int not null default 0,
  visible_to_players boolean not null default true,
  sort               int not null default 0,
  updated_at         timestamptz not null default now()
);
create index on public.clocks (campaign_id);

create table public.clues (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  text         text not null,
  found_by     uuid references public.characters(id) on delete set null,
  personal_for uuid references public.characters(id) on delete set null,
  is_arc       boolean not null default false,
  night        int,
  updated_at   timestamptz not null default now()
);
create index on public.clues (campaign_id);

create table public.scene (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null unique references public.campaigns(id) on delete cascade,
  title          text not null default '',
  text           text not null default '',
  round          int not null default 0,
  zones          jsonb not null default '[]'::jsonb,
  positions      jsonb not null default '{}'::jsonb,
  public_enemies jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

create table public.rolls (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  at            timestamptz not null default now(),
  actor_name    text not null default '',
  character_id  uuid references public.characters(id) on delete set null,
  label         text not null default '',
  stat          text,
  bonus         int not null default 0,
  edge          boolean not null default false,
  adv           int not null default 0 check (adv between -1 and 1),
  defense       int,
  dice          int[] not null default '{}',
  kept          int[] not null default '{}',
  total         int,
  margin        int,
  impact        int,
  mode          text not null default 'app' check (mode in ('app', 'manual')),
  note          text not null default '',
  rules_version text,
  updated_at    timestamptz not null default now()
);
create index on public.rolls (campaign_id, at desc);

-- GM only ----------------------------------------------------------------

create table public.gm_secrets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  "case"      jsonb not null default '{}'::jsonb,
  arc         jsonb not null default '{}'::jsonb,
  notes       text not null default '',
  updated_at  timestamptz not null default now()
);

create table public.enemies (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null,
  kind        text not null default 'mooks' check (kind in ('mooks', 'lieutenant', 'villain')),
  stats       jsonb not null default '{}'::jsonb,
  defenses    jsonb not null default '{}'::jsonb,
  toughness   int not null default 0,
  harm        int not null default 0,
  harm_max    int not null default 1,
  stress      int not null default 0,
  count       int not null default 1,
  count_max   int not null default 1,
  drive       int not null default 0,
  zone        text,
  line        text not null default '',
  source_id   text,
  updated_at  timestamptz not null default now()
);
create index on public.enemies (campaign_id);

create table public.encounters (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null default 'Encounter',
  config      jsonb not null default '{}'::jsonb,
  last_result jsonb,
  updated_at  timestamptz not null default now()
);
create index on public.encounters (campaign_id);

create table public.imports (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  at          timestamptz not null default now(),
  note        text not null default '',
  patch       jsonb not null,
  before      jsonb,
  applied     boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index on public.imports (campaign_id);

create table public.helper_log (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  at          timestamptz not null default now(),
  question    text not null,
  answer      text,
  model       text,
  updated_at  timestamptz not null default now()
);
create index on public.helper_log (campaign_id, at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['campaigns','characters','members','clocks','clues','scene',
                           'rolls','gm_secrets','enemies','encounters','imports','helper_log']
  loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- access helpers
-- security definer so policies can consult `members` without recursing
-- through members' own RLS. They live in `private`, which the Data API does
-- not expose, and only answer questions about the calling user.

create or replace function private.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                 where m.campaign_id = cid and m.user_id = (select auth.uid()));
$$;

create or replace function private.is_gm(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                 where m.campaign_id = cid and m.user_id = (select auth.uid())
                   and m.role = 'gm');
$$;

create or replace function private.owns_character(cid uuid, chid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                 where m.campaign_id = cid and m.user_id = (select auth.uid())
                   and m.character_id = chid);
$$;

create or replace function private.campaign_setting(cid uuid, key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((c.settings ->> key)::boolean, false)
  from public.campaigns c where c.id = cid;
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_member(uuid), private.is_gm(uuid),
  private.owns_character(uuid, uuid), private.campaign_setting(uuid, text) to authenticated;

-- ---------------------------------------------------------------- grants + RLS
-- Only signed-in devices (anonymous users are `authenticated`) touch tables,
-- and RLS decides which rows.

do $$
declare t text;
begin
  foreach t in array array['campaigns','characters','members','clocks','clues','scene',
                           'rolls','gm_secrets','enemies','encounters','imports','helper_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- campaigns: members read, GM writes. Created only via create_campaign().
create policy campaigns_read on public.campaigns for select to authenticated
  using (private.is_member(id));
create policy campaigns_gm_update on public.campaigns for update to authenticated
  using (private.is_gm(id)) with check (private.is_gm(id));
create policy campaigns_gm_delete on public.campaigns for delete to authenticated
  using (private.is_gm(id));

-- members: a device sees its own row; members see who else is at the table
-- (needed to show which heroes are claimed). Writes only via RPCs, except a
-- GM may remove a member.
create policy members_read on public.members for select to authenticated
  using (private.is_member(campaign_id));
create policy members_gm_delete on public.members for delete to authenticated
  using (private.is_gm(campaign_id));

-- characters
create policy characters_read on public.characters for select to authenticated
  using (
    private.is_gm(campaign_id)
    or private.owns_character(campaign_id, id)
    or (private.is_member(campaign_id)
        and private.campaign_setting(campaign_id, 'players_see_sheets'))
  );
create policy characters_insert on public.characters for insert to authenticated
  with check (
    private.is_gm(campaign_id)
    or (private.is_member(campaign_id)
        and private.campaign_setting(campaign_id, 'players_can_build')
        and not is_npc and not locked)
  );
create policy characters_update on public.characters for update to authenticated
  using (private.is_gm(campaign_id) or private.owns_character(campaign_id, id))
  with check (private.is_gm(campaign_id) or private.owns_character(campaign_id, id));
create policy characters_gm_delete on public.characters for delete to authenticated
  using (private.is_gm(campaign_id));

-- A player may edit their own sheet but not the GM's controls on it.
create or replace function private.guard_character_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.is_gm(old.campaign_id) then
    if new.campaign_id is distinct from old.campaign_id
       or new.locked is distinct from old.locked
       or new.is_npc is distinct from old.is_npc then
      raise exception 'Only the GM can change campaign, locked or NPC status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_character_update before update on public.characters
  for each row execute function private.guard_character_update();

-- clocks: players see visible ones, GM sees and writes all.
create policy clocks_read on public.clocks for select to authenticated
  using (private.is_gm(campaign_id)
         or (visible_to_players and private.is_member(campaign_id)));
create policy clocks_gm_write on public.clocks for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));

-- clues and scene: members read, GM writes.
create policy clues_read on public.clues for select to authenticated
  using (private.is_member(campaign_id));
create policy clues_gm_write on public.clues for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));

create policy scene_read on public.scene for select to authenticated
  using (private.is_member(campaign_id));
create policy scene_gm_write on public.scene for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));

-- rolls: members read all; players add rolls for their own hero; GM adds and deletes.
create policy rolls_read on public.rolls for select to authenticated
  using (private.is_member(campaign_id));
create policy rolls_insert on public.rolls for insert to authenticated
  with check (private.is_gm(campaign_id)
              or (character_id is not null and private.owns_character(campaign_id, character_id)));
create policy rolls_gm_update on public.rolls for update to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create policy rolls_gm_delete on public.rolls for delete to authenticated
  using (private.is_gm(campaign_id));

-- GM-only tables
create policy gm_secrets_gm on public.gm_secrets for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create policy enemies_gm on public.enemies for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create policy encounters_gm on public.encounters for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create policy imports_gm on public.imports for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create policy helper_log_gm on public.helper_log for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));

-- ---------------------------------------------------------------- RPCs
-- The only ways to create or change a members row. Each checks auth.uid().

create or replace function private.new_join_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.campaigns where join_code = code);
  end loop;
  return code;
end $$;

-- Create a campaign; the caller becomes its GM.
create or replace function public.create_campaign(p_name text, p_passcode text, p_display_name text default 'GM')
returns table (campaign_id uuid, join_code text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  code text;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_passcode is null or char_length(p_passcode) < 4 then
    raise exception 'Passcode must be at least 4 characters' using errcode = '22023';
  end if;
  code := private.new_join_code();
  insert into public.campaigns (name, join_code) values (trim(p_name), code) returning id into cid;
  insert into private.campaign_keys (campaign_id, gm_code_hash)
    values (cid, extensions.crypt(p_passcode, extensions.gen_salt('bf', 8)));
  insert into public.members (campaign_id, user_id, role, display_name)
    values (cid, uid, 'gm', coalesce(nullif(trim(p_display_name), ''), 'GM'));
  insert into public.scene (campaign_id) values (cid);
  insert into public.gm_secrets (campaign_id) values (cid);
  insert into public.clocks (campaign_id, name, kind, size, sort) values
    (cid, 'Scheme', 'scheme', 8, 0),
    (cid, 'Heat',   'heat',   6, 1);
  return query select cid, code;
end $$;

-- Join as a player by join code. Idempotent; never downgrades a GM.
create or replace function public.join_campaign(p_join_code text, p_display_name text default '')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select c.id into cid from public.campaigns c where c.join_code = upper(trim(p_join_code));
  if cid is null then raise exception 'No campaign with that code' using errcode = 'P0002'; end if;
  insert into public.members (campaign_id, user_id, role, display_name)
    values (cid, uid, 'player', coalesce(p_display_name, ''))
    on conflict (campaign_id, user_id) do nothing;
  return cid;
end $$;

-- Become the GM of a campaign with its passcode. Takes the campaign's
-- join code or id, so the GM page can ask for the short code.
create or replace function public.claim_gm(p_campaign text, p_passcode text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  hash text;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select c.id into cid from public.campaigns c
   where c.join_code = upper(trim(p_campaign)) or c.id::text = trim(p_campaign);
  if cid is null then raise exception 'Wrong campaign or passcode' using errcode = '28P01'; end if;
  select k.gm_code_hash into hash from private.campaign_keys k where k.campaign_id = cid;
  if hash is null or extensions.crypt(p_passcode, hash) <> hash then
    raise exception 'Wrong campaign or passcode' using errcode = '28P01';
  end if;
  insert into public.members (campaign_id, user_id, role, display_name)
    values (cid, uid, 'gm', 'GM')
    on conflict (campaign_id, user_id) do update set role = 'gm';
  return cid;
end $$;

-- Change a campaign's GM passcode (GM only).
create or replace function public.set_gm_passcode(p_campaign_id uuid, p_passcode text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_gm(p_campaign_id) then raise exception 'GM only' using errcode = '42501'; end if;
  if p_passcode is null or char_length(p_passcode) < 4 then
    raise exception 'Passcode must be at least 4 characters' using errcode = '22023';
  end if;
  update private.campaign_keys
     set gm_code_hash = extensions.crypt(p_passcode, extensions.gen_salt('bf', 8))
   where campaign_id = p_campaign_id;
end $$;

-- New join code (GM only); old links stop working for new joins.
create or replace function public.rotate_join_code(p_campaign_id uuid)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare code text;
begin
  if not private.is_gm(p_campaign_id) then raise exception 'GM only' using errcode = '42501'; end if;
  code := private.new_join_code();
  update public.campaigns set join_code = code where id = p_campaign_id;
  return code;
end $$;

-- Pick a hero (or pass null to let go of one). Two devices may claim the same hero.
create or replace function public.claim_character(p_character_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_character_id is null then
    raise exception 'Character required' using errcode = '22023';
  end if;
  select ch.campaign_id into cid from public.characters ch where ch.id = p_character_id;
  if cid is null or not private.is_member(cid) then
    raise exception 'Not a member of that campaign' using errcode = '42501';
  end if;
  update public.members set character_id = p_character_id
   where campaign_id = cid and user_id = uid;
end $$;

-- GM: unclaim a hero from every device that holds it.
create or replace function public.unclaim_character(p_character_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid;
begin
  select ch.campaign_id into cid from public.characters ch where ch.id = p_character_id;
  if cid is null or not private.is_gm(cid) then raise exception 'GM only' using errcode = '42501'; end if;
  update public.members set character_id = null where character_id = p_character_id;
end $$;

-- Lock down function execution: no anon access, signed-in devices only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_campaign(text, text, text)',
    'public.join_campaign(text, text)',
    'public.claim_gm(text, text)',
    'public.set_gm_passcode(uuid, text)',
    'public.rotate_join_code(uuid)',
    'public.claim_character(uuid)',
    'public.unclaim_character(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.new_join_code() from public;
revoke all on function private.touch_updated_at() from public;
revoke all on function private.guard_character_update() from public;

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table
  public.campaigns, public.characters, public.clocks, public.clues, public.scene, public.rolls;
