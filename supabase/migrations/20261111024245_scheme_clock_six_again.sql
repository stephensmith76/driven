-- Scheme clock is 6 segments, as in rules.md ("The clocks" table). Stephen confirmed Nov 11.
-- (The M2 migration briefly set it to 8.) The sizes here must match rules/data/core.json;
-- supabase/tests/access.test.ts checks that.

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
    (cid, 'Scheme', 'scheme', 6, 0),
    (cid, 'Heat',   'heat',   6, 1);
  return query select cid, code;
end $$;

-- Existing campaigns: back to 6, keeping any ticks that fit.
update public.clocks set size = 6, filled = least(filled, 6)
 where kind = 'scheme' and size = 8;
