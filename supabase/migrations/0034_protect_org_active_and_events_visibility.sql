-- Same bug class as 0033, on the column 0032 introduced on organizations:
-- "organizations update admin" (0002_rls.sql) has no column restriction,
-- so a deactivated org's own owner/admin could PATCH is_active back to
-- true themselves. Confirmed live via a real PostgREST call before this
-- fix. Mirrors 0033's technique exactly.
drop policy "organizations update admin" on organizations;
create policy "organizations update admin" on organizations
  for update using (public.is_org_admin(id))
  with check (
    public.is_org_admin(id)
    and is_active = (select o2.is_active from organizations o2 where o2.id = organizations.id)
  );

-- Org deactivation (0032) narrowed locations select all but not events
-- select all, so a deactivated org's events stayed publicly visible via
-- events/page.tsx's left-join query. Same narrowing, same org-active
-- check, reusing the existing org_id_for_location helper (0015).
drop policy "events select all" on events;
create policy "events select all" on events
  for select using (
    public.is_org_member(public.org_id_for_location(location_id))
    or public.is_platform_admin()
    or exists (
      select 1 from organizations o
      where o.id = public.org_id_for_location(location_id) and o.is_active
    )
  );
