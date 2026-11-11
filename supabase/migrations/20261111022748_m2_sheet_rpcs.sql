-- M2: character sheets.
--  * Scheme clock back to 8 segments for now (Stephen, Nov 11). rules.md still says 6.
--  * characters.extra_slots: slots gained through Advancement.
--  * Small RPCs so a tap changes one value (SPEC.md principle 6). All SECURITY
--    INVOKER: they run as the caller, so row-level security still decides who may
--    change which hero.
--  * The GM's "lock" is enforced in the database, not just hidden in the page.

alter table public.characters add column if not exists extra_slots int not null default 0
  check (extra_slots between 0 and 10);

-- ---------------------------------------------------------------- Scheme clock = 8
create or replace function public.create_campaign(
  p_name text, p_passcode text, p_display_name text default 'GM', p_rules_version text default null)
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
  insert into public.campaigns (name, join_code, rules_version)
    values (trim(p_name), code, p_rules_version) returning id into cid;
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

update public.clocks set size = 8 where kind = 'scheme' and size = 6;

-- ---------------------------------------------------------------- one-value writes

-- Add or subtract from a tracker, clamped to its range. Returns the new value
-- (null if the caller may not change that hero).
create or replace function public.bump_character(p_character_id uuid, p_field text, p_delta int)
returns int
language plpgsql volatile security invoker set search_path = '' as $$
declare
  hi int;
  v int;
begin
  hi := case p_field when 'stress' then 8 when 'drive' then 6
                     when 'home_clock' then 6 when 'harm' then 10 end;
  if hi is null then raise exception 'Unknown tracker %', p_field using errcode = '22023'; end if;
  execute format('update public.characters set %1$I = greatest(0, least(%2$s, %1$I + $1)) where id = $2 returning %1$I',
                 p_field, hi)
    into v using p_delta, p_character_id;
  return v;
end $$;

-- Set one key of fight_state. A JSON null removes the key.
create or replace function public.set_fight_flag(p_character_id uuid, p_key text, p_value jsonb)
returns void
language sql volatile security invoker set search_path = '' as $$
  update public.characters
     set fight_state = case when p_value = 'null'::jsonb
                            then coalesce(fight_state, '{}'::jsonb) - p_key
                            else coalesce(fight_state, '{}'::jsonb) || jsonb_build_object(p_key, p_value) end
   where id = p_character_id;
$$;

-- New fight: clear the per-fight flags (strange power used, Second Wind used,
-- Kit used, item uses) and keep everything else in fight_state.
create or replace function public.new_fight(p_character_id uuid)
returns void
language sql volatile security invoker set search_path = '' as $$
  update public.characters
     set fight_state = coalesce(
           (select jsonb_object_agg(t.k, t.v)
              from jsonb_each(coalesce(fight_state, '{}'::jsonb)) as t(k, v)
             where t.k not in ('strange_used', 'second_wind_used')
               and t.k not like 'uses:%' and t.k not like 'kit:%'),
           '{}'::jsonb)
   where id = p_character_id;
$$;

-- Replace the Kit picks in the loadout; gear and powers are left alone.
create or replace function public.set_kit(p_character_id uuid, p_ids text[])
returns void
language sql volatile security invoker set search_path = '' as $$
  update public.characters
     set loadout = coalesce((select jsonb_agg(e order by o)
                               from jsonb_array_elements(loadout) with ordinality as t(e, o)
                              where e ->> 'kind' is distinct from 'kit'), '[]'::jsonb)
                   || coalesce((select jsonb_agg(jsonb_build_object('kind', 'kit', 'id', id) order by o)
                                  from unnest(p_ids) with ordinality as u(id, o)), '[]'::jsonb)
   where id = p_character_id;
$$;

revoke all on function public.bump_character(uuid, text, int), public.set_fight_flag(uuid, text, jsonb),
  public.new_fight(uuid), public.set_kit(uuid, text[]) from public, anon;
grant execute on function public.bump_character(uuid, text, int), public.set_fight_flag(uuid, text, jsonb),
  public.new_fight(uuid), public.set_kit(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------- sheet lock
-- A locked sheet keeps its build (name, identity, archetype, Trait, stats, Flairs,
-- gear and powers). Trackers, notes and Kit picks still work, so a locked hero
-- stays playable.
create or replace function private.build_loadout(j jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(j, '[]'::jsonb)) with ordinality as t(e, o)
   where e ->> 'kind' is distinct from 'kit';
$$;

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
    if old.locked and (
         new.name is distinct from old.name
      or new.civilian is distinct from old.civilian
      or new.archetype_id is distinct from old.archetype_id
      or new.trait_id is distinct from old.trait_id
      or new.stats is distinct from old.stats
      or new.flair_ids is distinct from old.flair_ids
      or new.extra_slots is distinct from old.extra_slots
      or private.build_loadout(new.loadout) is distinct from private.build_loadout(old.loadout)) then
      raise exception 'This sheet is locked by the GM' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function private.build_loadout(jsonb) from public;
grant execute on function private.build_loadout(jsonb) to authenticated;
