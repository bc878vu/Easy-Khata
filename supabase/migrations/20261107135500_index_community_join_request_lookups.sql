-- Speed up community join-request lookups for applicants and reviewers.
begin;

create index if not exists khata_community_join_requests_user_idx
  on public.khata_community_join_requests (user_id);

create index if not exists khata_community_join_requests_reviewed_by_idx
  on public.khata_community_join_requests (reviewed_by)
  where reviewed_by is not null;

commit;
