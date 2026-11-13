-- A hero's own Trait (rules.md, "Your own Trait (trial)"). When trait_id is 'custom',
-- this holds { name, drive_trigger, steady, fraying, hook, breaking }. Otherwise null.
-- It is part of the build, so a locked sheet locks it too, like trait_id.
alter table public.characters
  add column if not exists custom_trait jsonb;

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
      or new.custom_trait is distinct from old.custom_trait
      or new.stats is distinct from old.stats
      or new.flair_ids is distinct from old.flair_ids
      or new.extra_slots is distinct from old.extra_slots
      or private.build_loadout(new.loadout) is distinct from private.build_loadout(old.loadout)) then
      raise exception 'This sheet is locked by the GM' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
