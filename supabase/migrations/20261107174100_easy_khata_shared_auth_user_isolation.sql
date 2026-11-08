-- Easy Khata-only hardening for this shared Supabase project.
-- No other application's tables, users, policies, or settings are changed.
alter table public.khata_workspace_members
  add column if not exists blocked_suspension boolean not null default false;

create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer
set search_path to '' set row_security to 'off'
as $function$
  select exists (
    select 1 from public.khata_workspace_members m
    join public.khata_workspaces w on w.id=m.workspace_id
    join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid())
      and m.status='active' and w.status='active'
      and (u.banned_until is null or u.banned_until<=now())
      and (p_roles is null or m.role=any(p_roles))
  );
$function$;

create or replace function private.shares_workspace_with(p_other_user uuid)
returns boolean language sql stable security definer
set search_path to '' set row_security to 'off'
as $function$
  select p_other_user=(select auth.uid()) or exists (
    select 1 from public.khata_workspace_members mine
    join public.khata_workspaces w on w.id=mine.workspace_id and w.status='active'
    join auth.users actor on actor.id=mine.user_id
    join auth.users target on target.id=p_other_user
    where mine.user_id=(select auth.uid()) and mine.status='active'
      and (actor.banned_until is null or actor.banned_until<=now())
      and (target.banned_until is null or target.banned_until<=now())
      and exists (
        select 1 from public.khata_workspace_members theirs
        where theirs.workspace_id=mine.workspace_id
          and theirs.user_id=p_other_user and theirs.status='active'
      )
  );
$function$;

create or replace function public.admin_add_workspace_member(p_workspace_id uuid,p_email text,p_role text default 'staff')
returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare v_user uuid;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_role not in ('admin','accountant','staff','viewer') then raise exception 'Invalid member role'; end if;
  if not exists(select 1 from public.khata_workspaces where id=p_workspace_id and type='business' and status='active') then raise exception 'Active business community not found'; end if;
  select u.id into v_user from auth.users u
  where lower(u.email)=lower(trim(coalesce(p_email,'')))
    and (u.banned_until is null or u.banned_until<=now())
    and (exists(select 1 from public.khata_profiles p where p.id=u.id) or u.raw_user_meta_data->>'app'='easy-khata');
  if v_user is null then raise exception 'Active Easy Khata user with this email was not found'; end if;
  insert into public.khata_workspace_members(workspace_id,user_id,role,status,blocked_suspension)
  values(p_workspace_id,v_user,p_role,'active',false)
  on conflict(workspace_id,user_id) do update
    set role=case when public.khata_workspace_members.role='owner' then 'owner' else excluded.role end,
        status='active',blocked_suspension=false;
  return v_user;
end;
$function$;

create or replace function public.admin_update_user(p_target uuid,p_name text,p_phone text)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth','extensions'
as $function$
begin
  if coalesce(auth.jwt()->>'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_profiles where id=p_target)
     and not exists(select 1 from auth.users where id=p_target and raw_user_meta_data->>'app'='easy-khata') then raise exception 'Not an Easy Khata user'; end if;
  update public.khata_profiles set name=coalesce(nullif(trim(p_name),''),name),phone=nullif(trim(p_phone),'') where id=p_target;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('full_name',trim(p_name))
  where id=p_target and nullif(trim(p_name),'') is not null
    and (exists(select 1 from public.khata_profiles where id=p_target) or raw_user_meta_data->>'app'='easy-khata');
end;
$function$;

create or replace function public.admin_set_user_password(p_target uuid,p_password text)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth','extensions'
as $function$
begin
  if coalesce(auth.jwt()->>'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_profiles where id=p_target)
     and not exists(select 1 from auth.users where id=p_target and raw_user_meta_data->>'app'='easy-khata') then raise exception 'Not an Easy Khata user'; end if;
  if length(p_password)<6 then raise exception 'password too short'; end if;
  update auth.users set encrypted_password=extensions.crypt(p_password,extensions.gen_salt('bf')),updated_at=now() where id=p_target;
end;
$function$;

create or replace function public.admin_delete_user(target_id uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $function$
begin
  if coalesce(auth.jwt()->>'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if target_id=auth.uid() then raise exception 'Cannot deactivate the current admin account'; end if;
  if not exists(select 1 from public.khata_profiles where id=target_id)
     and not exists(select 1 from auth.users where id=target_id and raw_user_meta_data->>'app'='easy-khata') then raise exception 'Not an Easy Khata user'; end if;
  if exists(select 1 from public.khata_workspace_members m where m.user_id=target_id and m.role='owner' and m.status='active'
    and (select count(*) from public.khata_workspace_members x where x.workspace_id=m.workspace_id and x.role='owner' and x.status='active')<=1) then
    raise exception 'Transfer workspace ownership before deactivating this owner';
  end if;
  update auth.users set banned_until='2099-01-01 00:00:00+00'::timestamptz,updated_at=now() where id=target_id;
  update public.khata_workspace_members set status='suspended',blocked_suspension=true where user_id=target_id and status='active';
end;
$function$;

create or replace function public.admin_set_user_blocked(p_target uuid,p_blocked boolean)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth','extensions'
as $function$
begin
  if coalesce(auth.jwt()->>'email','') <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_profiles where id=p_target)
     and not exists(select 1 from auth.users where id=p_target and raw_user_meta_data->>'app'='easy-khata') then raise exception 'Not an Easy Khata user'; end if;
  if p_blocked and exists(select 1 from public.khata_workspace_members m where m.user_id=p_target and m.role='owner' and m.status='active'
    and (select count(*) from public.khata_workspace_members x where x.workspace_id=m.workspace_id and x.role='owner' and x.status='active')<=1) then
    raise exception 'Transfer workspace ownership before blocking this owner';
  end if;
  if p_blocked then
    update auth.users set banned_until='2099-01-01 00:00:00+00'::timestamptz,updated_at=now() where id=p_target;
    update public.khata_workspace_members set status='suspended',blocked_suspension=true where user_id=p_target and status='active';
  else
    update auth.users set banned_until=null,updated_at=now() where id=p_target;
    update public.khata_workspace_members set status='active',blocked_suspension=false where user_id=p_target and blocked_suspension=true;
  end if;
end;
$function$;

create or replace function public.admin_update_workspace_member(p_workspace_id uuid,p_user_id uuid,p_role text,p_status text)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare v_target_role text; v_owners bigint;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_role not in ('owner','admin','accountant','staff','viewer') then raise exception 'Invalid role'; end if;
  if p_status not in ('active','suspended','removed') then raise exception 'Invalid member status'; end if;
  select role into v_target_role from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception 'Community member not found'; end if;
  if p_role='owner' and v_target_role<>'owner' then raise exception 'Use Make owner to transfer ownership safely'; end if;
  if v_target_role='owner' and (p_role<>'owner' or p_status<>'active') then
    select count(*) into v_owners from public.khata_workspace_members where workspace_id=p_workspace_id and role='owner' and status='active';
    if v_owners<=1 then raise exception 'Transfer ownership before changing the last active owner'; end if;
  end if;
  update public.khata_workspace_members set role=p_role,status=p_status,blocked_suspension=false where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$function$;

create or replace function public.khata_remove_workspace_member(p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer
set search_path to ''
as $function$
declare v_actor_role text; v_target_role text; v_owners bigint;
begin
  select role into v_actor_role from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=(select auth.uid()) and status='active';
  select role into v_target_role from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and status='active';
  if v_actor_role not in ('owner','admin') or v_target_role is null then raise exception 'Not authorized'; end if;
  if v_actor_role='admin' and v_target_role in ('owner','admin') then raise exception 'Admin cannot remove owner/admin'; end if;
  if v_target_role='owner' then
    select count(*) into v_owners from public.khata_workspace_members where workspace_id=p_workspace_id and role='owner' and status='active';
    if v_owners<=1 then raise exception 'Workspace must keep at least one active owner'; end if;
  end if;
  update public.khata_workspace_members set status='removed',blocked_suspension=false where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$function$;

create or replace function public.admin_transfer_workspace_owner(p_workspace_id uuid,p_new_owner uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $function$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_workspaces where id=p_workspace_id and type='business') then raise exception 'Business community not found'; end if;
  if not exists(select 1 from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_new_owner and status='active') then raise exception 'New owner must be an active member'; end if;
  update public.khata_workspace_members set role='admin',blocked_suspension=false where workspace_id=p_workspace_id and role='owner' and user_id<>p_new_owner and status='active';
  update public.khata_workspace_members set role='owner',status='active',blocked_suspension=false where workspace_id=p_workspace_id and user_id=p_new_owner;
end;
$function$;
