-- Easy Khata only: profiles are shared only by active members of the same community.
-- Historical ledger rows must not expose a non-member's profile.
create or replace function private.shares_workspace_with(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
set row_security to 'off'
as $function$
  select p_other_user = (select auth.uid())
    or exists (
      select 1
      from public.khata_workspace_members mine
      join public.khata_workspaces w
        on w.id = mine.workspace_id
       and w.status = 'active'
      where mine.user_id = (select auth.uid())
        and mine.status = 'active'
        and exists (
          select 1
          from public.khata_workspace_members theirs
          where theirs.workspace_id = mine.workspace_id
            and theirs.user_id = p_other_user
            and theirs.status = 'active'
        )
    );
$function$;
