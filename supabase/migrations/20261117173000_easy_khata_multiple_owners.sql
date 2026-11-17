-- Easy Khata v134: "Make owner" additive banao — multiple owners allowed.
-- Pehle: transfer karte waqt baaki active owners ko admin bana diya jata tha
-- (single-owner semantics, 20261107135000 + 20261107174100). Ab: naya owner
-- add hota hai, baaki owners owners hi rehte hain — is liye ek community
-- mein multiple admin AND multiple owner ban sakte hain.
-- admin_update_workspace_member ka last-active-owner guard waisa hi hai:
-- akela owner ab bhi demote/suspend/remove nahi ho sakta (pehle doosra
-- owner banao, phir pehle ko change karo).
-- NOTE: repo push SQL apply NAHI karta — ye file live bewx database mein
-- Supabase dashboard → SQL editor mein run karni hai. Us ke baad app ka
-- "Make owner" confirm/message text bhi naye behaviour ke mutabiq badlega (v135).
create or replace function public.admin_transfer_workspace_owner(p_workspace_id uuid,p_new_owner uuid)
returns void language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $function$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'a.m.a63425@gmail.com' then raise exception 'not admin'; end if;
  if not exists(select 1 from public.khata_workspaces where id=p_workspace_id and type='business') then raise exception 'Business community not found'; end if;
  if not exists(select 1 from public.khata_workspace_members where workspace_id=p_workspace_id and user_id=p_new_owner and status='active') then
    raise exception 'New owner must be an active member';
  end if;
  update public.khata_workspace_members set role='owner',status='active',blocked_suspension=false where workspace_id=p_workspace_id and user_id=p_new_owner;
end;
$function$;
