-- Easy Khata tenant isolation hardening.
-- This migration is safe to re-run: it only tightens grants and policies.
begin;

-- Private implementation tables are never exposed through the Supabase Data API.
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;
alter table private.ek_mt_backup_20261107 enable row level security;
alter table private.khata_community_join_attempts enable row level security;

-- Workspace and membership mutations must go through the audited RPC functions.
-- The browser only needs direct SELECT access to populate the workspace switcher
-- and the member list. SECURITY DEFINER RPCs continue to perform authorized writes.
revoke all privileges on table public.khata_workspaces from public, anon, authenticated;
revoke all privileges on table public.khata_workspace_members from public, anon, authenticated;
grant select on table public.khata_workspaces to authenticated;
grant select on table public.khata_workspace_members to authenticated;

drop policy if exists khata_workspace_members_admin_update on public.khata_workspace_members;
drop policy if exists khata_workspaces_owner_update on public.khata_workspaces;

commit;
