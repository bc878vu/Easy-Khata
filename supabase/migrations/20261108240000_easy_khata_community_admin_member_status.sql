-- Easy Khata v96: community owner/admin can suspend / restore a member
-- (previously the modal only had Remove; the only status RPC was the
-- platform-admin-only admin_update_workspace_member).
-- Mirrors khata_remove_workspace_member's auth: actor must be an active
-- owner/admin; an admin cannot touch owner/admin targets; the last active
-- owner keeps the workspace; a platform-blocked member cannot be restored
-- from here; self-status changes are refused.
create or replace function public.khata_set_workspace_member_status(p_workspace_id uuid, p_user_id uuid, p_status text)
returns void language plpgsql security definer
set search_path to ''
as $function$
declare v_actor_role text; v_target_role text; v_target_status text; v_target_blocked boolean; v_owners bigint;
begin
  if p_status not in ('active','suspended') then raise exception 'Invalid member status'; end if;
  if p_user_id = (select auth.uid()) then raise exception 'Cannot change your own status'; end if;
  select role into v_actor_role from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=(select auth.uid()) and status='active';
  select role, status, blocked_suspension into v_target_role, v_target_status, v_target_blocked from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
  if v_actor_role not in ('owner','admin') or v_target_role is null then raise exception 'Not authorized'; end if;
  if v_target_status = 'removed' then raise exception 'Removed member cannot be restored from here'; end if;
  if v_actor_role='admin' and v_target_role in ('owner','admin') then raise exception 'Admin cannot suspend owner/admin'; end if;
  if p_status='active' and coalesce(v_target_blocked,false) then raise exception 'Member blocked by platform admin'; end if;
  if v_target_role='owner' and p_status='suspended' then
    select count(*) into v_owners from public.khata_workspace_members where workspace_id=p_workspace_id and role='owner' and status='active';
    if v_owners<=1 then raise exception 'Workspace must keep at least one active owner'; end if;
  end if;
  update public.khata_workspace_members set status=p_status,blocked_suspension=false where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$function$;
