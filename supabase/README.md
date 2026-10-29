# CivicPulse Supabase database

This migration belongs to the dedicated CivicPulse project, not the existing Chatapp/chatZ projects.

## Project
- Supabase project ref: `ccrhdrjywnaccthzyjte`
- Region: `ap-south-1` (Mumbai)
- Project URL: `https://ccrhdrjywnaccthzyjte.supabase.co`

## Apply schema
The migration at `migrations/20261029130000_initial_civicpulse_schema.sql` defines:
- `profiles`: app roles and display names, linked to Supabase Auth
- `civic_issues`: ticket lifecycle, severity/priority, coordinates (PostGIS), secure image paths, AI metadata
- `issue_events`: audit trail for issue workflow
- `issue_comments`: resident/staff discussion
- `issue_votes`: one vote per authenticated user per issue

All public tables enable Row Level Security. User identity comes from `auth.uid()`; do not trust user-editable profile metadata for staff authorization. New profiles are created by a database trigger when Auth users sign up.

## Client configuration
Use the project URL above and the Supabase **publishable** key in the Supabase dashboard as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A publishable key is safe for browser use only when RLS is enabled and policies are correct. Never expose a service-role/secret key in frontend variables.

## Important before production
- Promote staff/admin roles only through a trusted administrative process, never through public profile updates.
- The current starter policies let authenticated users read all issues, comments, events and votes; review privacy expectations before using real resident data.
- Upload files into a private Storage bucket with authenticated policies; don't store public image URLs for sensitive reports.
- Add integration tests for RLS policies, moderation/abuse limits, and role escalation.
