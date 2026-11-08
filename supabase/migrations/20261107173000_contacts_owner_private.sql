-- Manual contacts are personal address-book entries, not shared community members.
-- Keep the existing tenant-membership policies, but restrict every SELECT to
-- the user who created/saved the contact. A contact becomes a shared person only
-- after the person has an account and is an active member (their profile is then
-- exposed by the workspace-membership profile policy).
begin;

alter table public.khata_contacts enable row level security;

drop policy if exists khata_contacts_owner_private_select on public.khata_contacts;
create policy khata_contacts_owner_private_select
  on public.khata_contacts
  as restrictive
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.khata_workspace_members m
      where m.workspace_id = khata_contacts.workspace_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  );

comment on policy khata_contacts_owner_private_select on public.khata_contacts is
  'Manual contacts are private to their owner; community members see a person only through an active workspace profile.';

commit;
