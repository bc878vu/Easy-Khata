# Easy Khata Multi-Tenant Architecture

## Product model

Easy Khata supports two workspace types:

- **Personal**: one private workspace is created automatically for every Auth user.
- **Business**: a shared workspace created by an owner; members join through expiring email-bound invitations.

A user can belong to several workspaces. The selected workspace is stored in `khata_profiles.active_workspace_id`. The browser always filters ledger and contact queries by this ID; PostgreSQL RLS independently checks membership.

## Database additions

- `khata_workspaces`: personal/business tenant records.
- `khata_workspace_members`: owner/admin/accountant/staff/viewer membership and active/suspended/removed status.
- `khata_workspace_invites`: single-use, seven-day, email-bound invitation tokens (only an MD5 digest of a 256-bit random token is stored).
- `khata_profiles.active_workspace_id`: selected workspace.
- `khata_contacts.workspace_id` and `khata_transactions.workspace_id`: tenant ownership.

Existing `payer_id` and `receiver_id` are retained for backwards compatibility. A party ID must resolve to an active workspace member profile or a contact in the same workspace. Existing IDs are preserved.

## Server-side authorization

The `private` schema contains non-exposed helpers:

- `private.has_workspace_role`
- `private.shares_workspace_with`
- `private.is_workspace_party`
- workspace bootstrap/default/immutability triggers

Public RPCs are authenticated-only and perform authorization inside PostgreSQL:

- `khata_create_business_workspace`
- `khata_set_active_workspace`
- `khata_create_workspace_invite`
- `khata_accept_workspace_invite`
- `khata_set_workspace_member_role`
- `khata_remove_workspace_member`

Direct client INSERT/UPDATE/DELETE of membership rows is blocked. Member changes go through the validated RPCs. A workspace must retain at least one active owner.

## RLS rules

- Profiles are visible to the current user's **active workspace members**, not globally.
- Transactions and contacts are visible only to members of their tenant workspace.
- Transaction INSERT requires the authenticated creator, an allowed role, and both parties to belong to that workspace.
- A transaction's `workspace_id` and `created_by` cannot be reassigned.
- Ordinary clients cannot hard-delete ledger rows; per-user hide/restore remains separate.
- Notifications are visible only to the recipient. An actor can create a notification only for a party on a transaction they created.
- Push subscriptions remain user-owned.
- Workspace audit/admin snapshots are not directly writable by clients.

## Legacy office migration

The existing six profiles each received an empty Personal workspace. The original shared office data was retained in one Business workspace, with the existing six users added as members. The existing Asad account is the owner; the other five legacy accounts are staff. All existing contacts and transactions were assigned to that office workspace. No transaction/contact IDs or financial fields were rewritten.

A database-side snapshot is retained in `private.ek_mt_backup_20261107` (not exposed through the Data API).

Verified baseline after migration:

| Item | Count |
|---|---:|
| Profiles | 6 |
| Personal workspaces | 6 |
| Business workspaces | 1 |
| Legacy office members | 6 |
| Contacts | 2 |
| Transactions | 17 |
| Backup rows | 25 |

All 17 transaction rows and both contact rows compare byte-for-byte with the backup after excluding the newly added `workspace_id` column. No contacts or transactions remain without a workspace.

## Client behavior

- Workspace selector switches via `khata_set_active_workspace`.
- Transaction/contact reads and writes include the active `workspace_id`.
- Realtime subscriptions filter by workspace and recipient.
- Workspace creation, invite creation/acceptance, role changes and member removal use the RPCs above.
- Local cache and offline outbox are now scoped per authenticated user. Pending records are pinned to their original workspace.
- The service worker no longer caches private Supabase table responses. Offline mode uses the app's account-scoped local cache.

## Platform admin behavior

Platform account deactivation is a **soft deactivation**: sign-in is banned and workspace memberships are suspended. Ledger rows are not cascade-deleted. Platform admin transaction edit/delete RPCs additionally require the admin to be an owner/admin/accountant in that transaction's workspace, preventing global support access to customer ledgers.

## Rollout notes

Database migrations were applied to the connected Supabase project on 2026-11-07. The app changes are on branch `feat/public-multitenant`; they should be preview-tested before merging to production. Do not re-run the backup snapshot insert manually. Future schema changes should be committed as Supabase CLI migration files and deployed through the normal migration workflow.
