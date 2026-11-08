-- Easy Khata platform admin: centralized business-community and member CRUD.
-- Every function independently checks the platform-admin identity.
begin;

create or replace function public.admin_list_workspaces()
returns table(
  id uuid,name text,slug text,type text,status text,created_by uuid,created_at timestamptz,
  community_username text,community_description text,community_listed boolean,
  password_configured boolean,member_count bigint,transaction_count bigint,
  contact_count bigint,transaction_volume numeric
)
language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  return query
  select w.id,w.name,w.slug,w.type,w.status,w.created_by,w.created_at,w.community_username,
    w.community_description,w.community_listed,(w.community_password_hash is not null),
    (select count(*) from public.khata_workspace_members m where m.workspace_id=w.id and m.status='active'),
    (select count(*) from public.khata_transactions t where t.workspace_id=w.id),
    (select count(*) from public.khata_contacts c where c.workspace_id=w.id),
    coalesce((select sum(t.amount) from public.khata_transactions t where t.workspace_id=w.id),0)::numeric
  from public.khata_workspaces w order by w.created_at desc;
end; $$;

create or replace function public.admin_update_workspace(
  p_workspace_id uuid,p_name text,p_username text,p_description text,p_listed boolean,p_password text default null
)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth','extensions'
as $$
declare v_ws public.khata_workspaces%rowtype; v_username text;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  select * into v_ws from public.khata_workspaces where id=p_workspace_id for update;
  if not found or v_ws.type<>'business' then raise exception 'Business community not found'; end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Community name must be 2-100 characters'; end if;
  v_username:=lower(trim(coalesce(p_username,'')));
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'Invalid community username'; end if;
  if p_password is not null and p_password<>'' and length(p_password)<10 then raise exception 'Password must be at least 10 characters'; end if;
  if coalesce(p_listed,false) and v_ws.community_password_hash is null and coalesce(p_password,'')='' then
    raise exception 'Set a community password before listing it in the public directory';
  end if;
  update public.khata_workspaces set name=trim(p_name),community_username=v_username,
    community_description=left(trim(coalesce(p_description,'')),240),community_listed=coalesce(p_listed,false),
    community_password_hash=case when p_password is not null and p_password<>'' then extensions.crypt(p_password,extensions.gen_salt('bf',12)) else community_password_hash end,
    updated_at=now() where id=p_workspace_id;
exception when unique_violation then raise exception 'Community username is already in use';
end; $$;

create or replace function public.admin_set_workspace_status(p_workspace_id uuid,p_status text)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare v_type text;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid community status'; end if;
  select type into v_type from public.khata_workspaces where id=p_workspace_id for update;
  if not found or v_type<>'business' then raise exception 'Business community not found'; end if;
  update public.khata_workspaces set status=p_status,updated_at=now() where id=p_workspace_id;
end; $$;

create or replace function public.admin_delete_workspace(p_workspace_id uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare v_type text; v_members bigint;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  select type into v_type from public.khata_workspaces where id=p_workspace_id for update;
  if not found or v_type<>'business' then raise exception 'Only business communities can be deleted'; end if;
  if exists(select 1 from public.khata_transactions where workspace_id=p_workspace_id) then
    raise exception 'Community has ledger transactions. Suspend it instead; financial history cannot be permanently deleted here.';
  end if;
  if exists(select 1 from public.khata_contacts where workspace_id=p_workspace_id) then
    raise exception 'Community has contacts. Remove contacts first or suspend the community.';
  end if;
  select count(*) into v_members from public.khata_workspace_members where workspace_id=p_workspace_id and status='active';
  if v_members>1 then raise exception 'Community still has active members. Remove members first.'; end if;
  update public.khata_profiles p set active_workspace_id=(
    select m.workspace_id from public.khata_workspace_members m
    join public.khata_workspaces pw on pw.id=m.workspace_id and pw.type='personal'
    where m.user_id=p.id and m.status='active' and m.workspace_id<>p_workspace_id
    order by m.joined_at asc limit 1
  ) where p.active_workspace_id=p_workspace_id;
  delete from public.khata_community_join_requests where workspace_id=p_workspace_id;
  delete from public.khata_workspace_invites where workspace_id=p_workspace_id;
  delete from public.khata_workspace_members where workspace_id=p_workspace_id;
  delete from public.khata_workspaces where id=p_workspace_id;
end; $$;

create or replace function public.admin_list_workspace_members()
returns table(
  workspace_id uuid,workspace_name text,workspace_status text,user_id uuid,user_name text,
  user_email text,user_phone text,role text,member_status text,joined_at timestamptz,blocked boolean
)
language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  return query
  select m.workspace_id,w.name,w.status,m.user_id,coalesce(p.name,p.email,'Unknown')::text,
    coalesce(p.email,'')::text,p.phone,m.role,m.status,m.joined_at,
    (u.banned_until is not null and u.banned_until>now())
  from public.khata_workspace_members m
  join public.khata_workspaces w on w.id=m.workspace_id
  left join public.khata_profiles p on p.id=m.user_id
  left join auth.users u on u.id=m.user_id
  where w.type='business' order by w.name,m.joined_at;
end; $$;

create or replace function public.admin_add_workspace_member(p_workspace_id uuid,p_email text,p_role text default 'staff')
returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare v_user uuid;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_role not in ('admin','accountant','staff','viewer') then raise exception 'Invalid member role'; end if;
  if not exists(select 1 from public.khata_workspaces where id=p_workspace_id and type='business' and status='active') then
    raise exception 'Active business community not found';
  end if;
  select id into v_user from auth.users where lower(email)=lower(trim(coalesce(p_email,''))) and banned_until is null;
  if v_user is null then raise exception 'Active registered user with this email was not found'; end if;
  insert into public.khata_workspace_members(workspace_id,user_id,role,status)
  values(p_workspace_id,v_user,p_role,'active')
  on conflict(workspace_id,user_id) do update
    set role=case when public.khata_workspace_members.role='owner' then 'owner' else excluded.role end,status='active';
  return v_user;
end; $$;

create or replace function public.admin_update_workspace_member(p_workspace_id uuid,p_user_id uuid,p_role text,p_status text)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare v_target_role text; v_owners bigint;
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if p_role not in ('owner','admin','accountant','staff','viewer') then raise exception 'Invalid role'; end if;
  if p_status not in ('active','suspended','removed') then raise exception 'Invalid member status'; end if;
  select role into v_target_role from public.khata_workspace_members
    where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception 'Community member not found'; end if;
  if p_role='owner' and v_target_role<>'owner' then raise exception 'Use Make owner to transfer ownership safely'; end if;
  if v_target_role='owner' and (p_role<>'owner' or p_status<>'active') then
    select count(*) into v_owners from public.khata_workspace_members
    where workspace_id=p_workspace_id and role='owner' and status='active';
    if v_owners<=1 then raise exception 'Transfer ownership before changing the last active owner'; end if;
  end if;
  update public.khata_workspace_members set role=p_role,status=p_status
    where workspace_id=p_workspace_id and user_id=p_user_id;
end; $$;

create or replace function public.admin_transfer_workspace_owner(p_workspace_id uuid,p_new_owner uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_workspaces where id=p_workspace_id and type='business') then raise exception 'Business community not found'; end if;
  if not exists(select 1 from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_new_owner and status='active') then
    raise exception 'New owner must be an active member';
  end if;
  update public.khata_workspace_members set role='admin'
    where workspace_id=p_workspace_id and role='owner' and user_id<>p_new_owner and status='active';
  update public.khata_workspace_members set role='owner',status='active'
    where workspace_id=p_workspace_id and user_id=p_new_owner;
end; $$;

revoke all on function public.admin_list_workspaces() from public,anon;
revoke all on function public.admin_update_workspace(uuid,text,text,text,boolean,text) from public,anon;
revoke all on function public.admin_set_workspace_status(uuid,text) from public,anon;
revoke all on function public.admin_delete_workspace(uuid) from public,anon;
revoke all on function public.admin_list_workspace_members() from public,anon;
revoke all on function public.admin_add_workspace_member(uuid,text,text) from public,anon;
revoke all on function public.admin_update_workspace_member(uuid,uuid,text,text) from public,anon;
revoke all on function public.admin_transfer_workspace_owner(uuid,uuid) from public,anon;

grant execute on function public.admin_list_workspaces() to authenticated;
grant execute on function public.admin_update_workspace(uuid,text,text,text,boolean,text) to authenticated;
grant execute on function public.admin_set_workspace_status(uuid,text) to authenticated;
grant execute on function public.admin_delete_workspace(uuid) to authenticated;
grant execute on function public.admin_list_workspace_members() to authenticated;
grant execute on function public.admin_add_workspace_member(uuid,text,text) to authenticated;
grant execute on function public.admin_update_workspace_member(uuid,uuid,text,text) to authenticated;
grant execute on function public.admin_transfer_workspace_owner(uuid,uuid) to authenticated;

commit;
