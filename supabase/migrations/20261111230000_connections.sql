-- Connections: four one-line ties to the world, written at character creation.
-- Keys: protect, leverage, place, mistake. Anyone who can edit the hero can edit them,
-- including on a locked sheet (a lost connection gets rewritten at Dawn), so the
-- sheet-lock trigger does not list this column.
alter table public.characters
  add column connections jsonb not null default '{}'::jsonb;
