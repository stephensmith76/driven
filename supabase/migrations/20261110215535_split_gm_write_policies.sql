-- Split "for all" GM policies on tables that also have a member SELECT policy,
-- so each action has a single permissive policy (advisor: multiple_permissive_policies).
-- Access is unchanged.
do $$
declare t text;
begin
  foreach t in array array['clocks', 'clues', 'scene'] loop
    execute format('drop policy %I on public.%I', t || '_gm_write', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (private.is_gm(campaign_id))', t || '_gm_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (private.is_gm(campaign_id)) with check (private.is_gm(campaign_id))', t || '_gm_update', t);
    execute format('create policy %I on public.%I for delete to authenticated
                    using (private.is_gm(campaign_id))', t || '_gm_delete', t);
  end loop;
end $$;
