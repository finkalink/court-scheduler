-- Terms of Service acceptance tracking. Freely self-editable under the
-- existing "users update own" policy (0002_rls.sql) -- neither column is
-- the kind of privilege column 0023_protect_users_identity_columns.sql
-- exists to pin. Freeform version string (no check constraint), matched
-- against the CURRENT_TOS_VERSION constant in src/lib/terms.ts -- bumping
-- that constant after a real document revision re-prompts every account
-- on its next sign-in, since a stale version no longer matches.
alter table users add column tos_accepted_version text;
alter table users add column tos_accepted_at timestamptz;
