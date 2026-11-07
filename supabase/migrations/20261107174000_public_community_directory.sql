-- The signup page can search public/listed communities before authentication.
-- The RPC returns only public community metadata and never password hashes or members' private data.
grant execute on function public.khata_list_communities(text) to anon, authenticated;

comment on function public.khata_list_communities(text) is
  'Public directory of listed communities only; returns names, usernames, descriptions and active member counts, never passwords or private member/contact data.';
