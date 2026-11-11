-- M3: campaign patch import with undo (SPEC.md "How Claude updates the app").
--
-- The page reads the patch, matches every op to exactly one row, shows a
-- before/after line for each, and then sends the resolved ops here. This
-- function applies them all in one transaction (all or none), records the old
-- values in imports.before, and returns the import id. undo_import() puts the
-- old values back and deletes inserted rows.
--
-- Both run as the caller (SECURITY INVOKER), so row-level security still
-- applies: only a GM can write these tables. They also check is_gm up front so
-- a non-GM gets a clear error instead of "0 rows".

-- Which columns a patch may touch.
create or replace function private.check_patch_columns(p_table text, p_cols text[], p_insert boolean)
returns void language plpgsql stable set search_path = '' as $$
declare
  c text;
  forbidden text[] := array['id', 'campaign_id', 'created_at', 'updated_at'];
begin
  if p_table = 'campaigns' then forbidden := forbidden || array['join_code']; end if;
  foreach c in array coalesce(p_cols, '{}') loop
    if p_insert and c = 'campaign_id' then continue; end if;
    if c = any(forbidden) then
      raise exception 'A patch cannot change %.%', p_table, c using errcode = '22023';
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = p_table and column_name = c) then
      raise exception '% has no column "%"', p_table, c using errcode = '42703';
    end if;
  end loop;
end $$;

create or replace function public.apply_patch_ops(
  p_campaign_id uuid, p_note text, p_patch jsonb, p_ops jsonb)
returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  allowed constant text[] := array['campaigns', 'characters', 'clocks', 'clues', 'scene',
                                   'gm_secrets', 'enemies', 'encounters'];
  single constant text[] := array['campaigns', 'scene', 'gm_secrets'];
  op jsonb;
  tbl text;
  rid uuid;
  vals jsonb;
  cols text[];
  before_row jsonb;
  undo jsonb := '[]'::jsonb;
  n int;
  new_id uuid;
  imp uuid;
begin
  if not private.is_gm(p_campaign_id) then
    raise exception 'Only the GM can import into this campaign' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' then
    raise exception 'ops must be a list' using errcode = '22023';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    tbl := op ->> 'table';
    if tbl is null or not tbl = any(allowed) then
      raise exception 'Table "%" cannot be patched', coalesce(tbl, '?') using errcode = '22023';
    end if;

    if op ->> 'op' = 'update' then
      rid := (op ->> 'id')::uuid;
      vals := op -> 'set';
      select array_agg(k) into cols from jsonb_object_keys(vals) as k;
      if cols is null then continue; end if;
      perform private.check_patch_columns(tbl, cols, false);

      if tbl = 'campaigns' then
        if rid is distinct from p_campaign_id then
          raise exception 'A patch can only change its own campaign' using errcode = '42501';
        end if;
        select to_jsonb(t) into before_row from public.campaigns t where t.id = rid;
      else
        execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.campaign_id = $2', tbl)
          into before_row using rid, p_campaign_id;
      end if;
      if before_row is null then
        raise exception 'No % row % in this campaign', tbl, rid using errcode = 'P0002';
      end if;

      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2',
                     tbl, (select string_agg(format('%I = r.%I', c, c), ', ') from unnest(cols) as c), tbl)
        using vals, rid;
      get diagnostics n = row_count;
      if n <> 1 then
        raise exception 'Could not update % row %', tbl, rid using errcode = 'P0002';
      end if;
      undo := undo || jsonb_build_array(jsonb_build_object(
        'op', 'update', 'table', tbl, 'id', rid,
        'before', (select jsonb_object_agg(c, before_row -> c) from unnest(cols) as c)));

    elsif op ->> 'op' = 'insert' then
      if tbl = any(single) then
        raise exception '% has one row per campaign: use set or merge, not insert', tbl using errcode = '22023';
      end if;
      vals := ((op -> 'row') - 'id' - 'campaign_id') || jsonb_build_object('campaign_id', p_campaign_id);
      select array_agg(k) into cols from jsonb_object_keys(vals) as k;
      perform private.check_patch_columns(tbl, cols, true);
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) r returning id',
                     tbl,
                     (select string_agg(format('%I', c), ', ') from unnest(cols) as c),
                     (select string_agg(format('r.%I', c), ', ') from unnest(cols) as c),
                     tbl)
        into new_id using vals;
      undo := undo || jsonb_build_array(jsonb_build_object('op', 'insert', 'table', tbl, 'id', new_id));

    else
      raise exception 'Unknown op "%"', coalesce(op ->> 'op', '?') using errcode = '22023';
    end if;
  end loop;

  insert into public.imports (campaign_id, note, patch, before, applied)
    values (p_campaign_id, coalesce(p_note, ''), p_patch, undo, true)
    returning id into imp;
  return imp;
end $$;

create or replace function public.undo_import(p_import_id uuid)
returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare
  imp public.imports;
  e jsonb;
  tbl text;
  cols text[];
  n int;
begin
  select * into imp from public.imports where id = p_import_id;
  if imp.id is null or not private.is_gm(imp.campaign_id) then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  if not imp.applied then
    raise exception 'That import was already undone' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(imp.before) with ordinality as t(value, ord) order by ord desc loop
    tbl := e ->> 'table';
    if e ->> 'op' = 'update' then
      select array_agg(k) into cols from jsonb_object_keys(e -> 'before') as k;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2',
                     tbl, (select string_agg(format('%I = r.%I', c, c), ', ') from unnest(cols) as c), tbl)
        using e -> 'before', (e ->> 'id')::uuid;
    else
      execute format('delete from public.%I where id = $1 and campaign_id = $2', tbl)
        using (e ->> 'id')::uuid, imp.campaign_id;
    end if;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'Undo could not restore % row % (was it deleted since?)', tbl, e ->> 'id' using errcode = 'P0002';
    end if;
  end loop;

  update public.imports set applied = false where id = p_import_id;
end $$;

revoke all on function private.check_patch_columns(text, text[], boolean) from public;
grant execute on function private.check_patch_columns(text, text[], boolean) to authenticated;
revoke all on function public.apply_patch_ops(uuid, text, jsonb, jsonb), public.undo_import(uuid) from public, anon;
grant execute on function public.apply_patch_ops(uuid, text, jsonb, jsonb), public.undo_import(uuid) to authenticated;
