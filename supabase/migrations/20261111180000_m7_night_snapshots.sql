-- M7: the state of the table at the start of each Night, for the session report. GM only.
create table public.night_snapshots (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  night       int  not null,
  at          timestamptz not null default now(),
  state       jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (campaign_id, night)
);
alter table public.night_snapshots enable row level security;
create policy night_snapshots_gm on public.night_snapshots for all to authenticated
  using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id));
create trigger night_snapshots_touch before update on public.night_snapshots
  for each row execute function private.touch_updated_at();
