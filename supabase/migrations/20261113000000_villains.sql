-- Built villains. A campaign keeps a roster of villain sheets the GM has made
-- (role, Trait lines, Tricks, Weakness, powers and so on). Adding one to a
-- fight copies its stat block onto an `enemies` row, with the rest of the
-- sheet in `enemies.details` so the Fight screen can show it.

create table public.villains (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null,
  kind        text not null default 'villain' check (kind in ('mooks', 'lieutenant', 'villain')),
  -- stats, defenses, toughness, harm_max, count_max, drive, line, details
  data        jsonb not null default '{}'::jsonb,
  portrait    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.villains (campaign_id);
create trigger touch_updated_at before update on public.villains
  for each row execute function private.touch_updated_at();

alter table public.villains enable row level security;
create policy villains_gm on public.villains for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));

alter table public.enemies add column if not exists details jsonb;
