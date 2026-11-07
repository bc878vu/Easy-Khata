-- Easy Khata only: keep manual address-book contacts private to their creator.
-- This migration affects only public.khata_contacts in the shared Supabase project.
drop policy if exists khata_contacts_select_workspace on public.khata_contacts;

drop policy if exists khata_contacts_select_owner_only on public.khata_contacts;
create policy khata_contacts_select_owner_only
on public.khata_contacts
as permissive
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.khata_workspace_members m
    where m.workspace_id = khata_contacts.workspace_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);

drop policy if exists khata_contacts_delete_workspace on public.khata_contacts;
drop policy if exists khata_contacts_delete_owner_only on public.khata_contacts;
create policy khata_contacts_delete_owner_only
on public.khata_contacts
for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, null::text[]))
);

drop policy if exists khata_contacts_update_workspace on public.khata_contacts;
drop policy if exists khata_contacts_update_owner_only on public.khata_contacts;
create policy khata_contacts_update_owner_only
on public.khata_contacts
for update
to authenticated
using (
  owner_id = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, null::text[]))
)
with check (
  owner_id = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, null::text[]))
);
