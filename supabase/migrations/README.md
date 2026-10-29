# Supabase migration source

The production Supabase project recorded migration versions `20261029151344` through `20261029161154`, but those SQL files were missing from the Git repository when the architecture rebuild began on 2026-10-30.

The files with those existing version names have therefore been **reconstructed from the live database catalog** (table definitions, enum labels, policies, indexes, triggers, functions and storage settings). They provide a source-controlled bootstrap for review and local testing; they are not claimed to be byte-for-byte copies of the original SQL that was previously run in production.

## Safety before using migrations

- Do not reset or drop the current production project.
- Run `supabase db reset` only against a disposable local/test database with PostGIS support.
- Compare the resulting tables, functions, policies, indexes, triggers and storage bucket configuration against `docs/architecture/DATABASE_DESIGN.md` and the current project schema.
- The new `20261030000000_architecture_rebuild_foundation.sql` is additive, but application code does not yet write to every new table. Treat the schema as foundation, not as a completed feature rollout.
- Do not change the existing `civic-issue-images` bucket to private in the same release as the schema migration; the live frontend currently uses its public URL. A private-media migration needs signed URL support and access tests first.

The live schema uses PostGIS in the `extensions` schema, enum types `civic_user_role`, `civic_issue_status`, and `civic_issue_severity`, and a public image bucket for compatibility. The privacy-first target described in the architecture docs is a future staged change, not a description of current live behavior.
