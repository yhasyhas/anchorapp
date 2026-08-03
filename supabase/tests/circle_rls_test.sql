/*
  Manual RLS verification for Circle of Trust (supabase/migrations/20260803130000_create_circle_of_trust.sql).

  There is no automated test runner or local Supabase stack in this repo
  (only a hosted project + a bare migrations/ folder) — run this by hand,
  statement by statement, in the Supabase SQL editor (or `psql` connected
  to the project) AFTER applying the migration above. It uses two disposable
  auth.users rows so it is safe to run against a scratch/staging project;
  do NOT run against production data without adjusting the emails below to
  real throwaway addresses first, and delete the test users afterward:

    DELETE FROM auth.users WHERE email IN ('circle-test-a@example.com', 'circle-test-b@example.com');

  Each numbered block should produce the result noted in its comment. If it
  doesn't, the corresponding policy/function/trigger is not behaving as
  designed and needs a fix before shipping.
*/

-- ----------------------------------------------------------------------------
-- Setup: two throwaway users + a third to prove circle_full behavior.
-- ----------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('00000000-0000-0000-0000-0000000000a1', 'circle-test-a@example.com', crypt('testpass', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'circle-test-b@example.com', crypt('testpass', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c1', 'circle-test-c@example.com', crypt('testpass', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d1', 'circle-test-d@example.com', crypt('testpass', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (id, full_name, preferred_language)
values
  ('00000000-0000-0000-0000-0000000000a1', 'Test A', 'en'),
  ('00000000-0000-0000-0000-0000000000b1', 'Test B', 'en'),
  ('00000000-0000-0000-0000-0000000000c1', 'Test C', 'en'),
  ('00000000-0000-0000-0000-0000000000d1', 'Test D', 'en')
on conflict (id) do nothing;

-- Helper: simulate "logged in as user X" for the rest of this session.
-- Run the `set_config` line, then the statements right after it, per block.

-- ----------------------------------------------------------------------------
-- 1. A invites B by email -> should create two 'pending' rows (A->B, B->A).
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('role', 'authenticated', true);
select circle_invite_by_email('circle-test-b@example.com');
-- EXPECT: {"matched": true, "friend_id": "00000000-0000-0000-0000-0000000000b1"}

select * from circle_memberships where user_id = '00000000-0000-0000-0000-0000000000a1';
-- EXPECT: one row, friend_id = B, status = 'pending' — visible because it's A's own row.

-- ----------------------------------------------------------------------------
-- 2. A must NOT be able to see B's row directly (only her own).
-- ----------------------------------------------------------------------------
select * from circle_memberships where user_id = '00000000-0000-0000-0000-0000000000b1';
-- EXPECT: 0 rows (RLS: auth.uid() = user_id only lets A see rows where user_id = A).

-- ----------------------------------------------------------------------------
-- 3. A cannot write directly to circle_memberships (no INSERT/UPDATE/DELETE
--    policy exists for `authenticated` at all — only the RPCs, running as
--    definer, can write).
-- ----------------------------------------------------------------------------
insert into circle_memberships (user_id, friend_id, status, invited_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'active', '00000000-0000-0000-0000-0000000000a1');
-- EXPECT: ERROR — new row violates row-level security policy (no policy permits this INSERT).

update circle_memberships set status = 'active' where user_id = '00000000-0000-0000-0000-0000000000a1';
-- EXPECT: 0 rows updated (UPDATE has no matching policy for `authenticated`, so it silently matches nothing).

-- ----------------------------------------------------------------------------
-- 4. B accepts -> both directions flip to 'active'. Switch identity to B.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select circle_accept_pending('00000000-0000-0000-0000-0000000000a1');

select * from circle_memberships where user_id = '00000000-0000-0000-0000-0000000000b1';
-- EXPECT: friend_id = A, status = 'active', accepted_at set.

-- Switch back to A and confirm her mirror row also flipped.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select * from circle_memberships where user_id = '00000000-0000-0000-0000-0000000000a1';
-- EXPECT: friend_id = B, status = 'active'.

-- ----------------------------------------------------------------------------
-- 5. circle_get_member_names only ever returns names for people the caller
--    already has a relationship row with — never an arbitrary user.
-- ----------------------------------------------------------------------------
select * from circle_get_member_names();
-- EXPECT: one row (friend_id = B, full_name = 'Test B').

select full_name from profiles where id = '00000000-0000-0000-0000-0000000000c1';
-- EXPECT under RLS as A: 0 rows — A cannot read C's profile at all, by name or otherwise.

-- ----------------------------------------------------------------------------
-- 6. Max-2-active: A invites C, C accepts (A now has 2 active). A invites D
--    -> should succeed as 'pending' (pending doesn't count), but D accepting
--    should fail with circle_full since A is already at 2 active.
-- ----------------------------------------------------------------------------
select circle_invite_by_email('circle-test-c@example.com');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
select circle_accept_pending('00000000-0000-0000-0000-0000000000a1');
-- EXPECT: success. A now has 2 active members (B, C).

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select circle_invite_by_email('circle-test-d@example.com');
-- EXPECT: ERROR circle_full (A already has 2 active members) — RPC's own check fires first.

-- Direct trigger check: try to force a 3rd active row for A even bypassing
-- the RPC's own guard, using the service_role (which the trigger still
-- applies to — triggers are not RLS, they cannot be bypassed by any role).
set role postgres;
insert into circle_memberships (user_id, friend_id, status, invited_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'active', '00000000-0000-0000-0000-0000000000a1');
-- EXPECT: ERROR circle_full raised by enforce_circle_max_active(), even as postgres.
reset role;

-- ----------------------------------------------------------------------------
-- 7. circle_invites: only the inviter can see her own sent invite rows.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select * from circle_invites where inviter_id = '00000000-0000-0000-0000-0000000000a1';
-- EXPECT: 0 rows (B is not the inviter on any circle_invites row, and there's
-- no policy letting anyone read another user's sent invites).

-- ----------------------------------------------------------------------------
-- 8. Remove member -> both direction rows gone immediately.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select circle_remove_member('00000000-0000-0000-0000-0000000000b1');

select * from circle_memberships where (user_id, friend_id) in (
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1')
);
-- EXPECT: 0 rows.

-- ----------------------------------------------------------------------------
-- Cleanup
-- ----------------------------------------------------------------------------
-- delete from circle_memberships where user_id in (
--   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
--   '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'
-- );
-- delete from circle_invites where inviter_id in (
--   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
--   '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'
-- );
-- delete from public.profiles where id in (
--   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
--   '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'
-- );
-- delete from auth.users where email in (
--   'circle-test-a@example.com', 'circle-test-b@example.com',
--   'circle-test-c@example.com', 'circle-test-d@example.com'
-- );
