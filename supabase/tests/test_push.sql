\set ON_ERROR_STOP 1
-- phone notification tokens (run after stub_supabase.sql, 0001 … 0005 and the
-- helpers at the top of test_activity_requests.sql: t_as/t_ok/t_err/t_eq)
set client_min_messages = notice;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-000000000001', 'ps@x.com', '{"full_name":"PushS"}'),
  ('30000000-0000-0000-0000-000000000002', 'pu@x.com', '{"full_name":"PushU"}'),
  ('30000000-0000-0000-0000-000000000003', 'po@x.com', '{"full_name":"Outsider"}');
select public.t_as('30000000-0000-0000-0000-000000000001');
create temp table pg as select (public.create_meal_group('Push Mess', 'PushS'))::json as j;
grant select on pg to authenticated;
do $$ declare code text; gid uuid; begin
  select (j->>'invite_code'), (j->>'group_id')::uuid into code, gid from pg;
  perform public.t_as('30000000-0000-0000-0000-000000000002'); perform public.join_meal_group(code);
  -- still PENDING: may not register a phone yet
  perform public.t_err(format('select public.save_push_token(%L, %L)', gid, 'pending-token-123'), 'FORBIDDEN');
  perform public.t_as('30000000-0000-0000-0000-000000000001');
  if exists (select 1 from public.list_join_requests(gid)) then perform public.approve_join_request(gid, '30000000-0000-0000-0000-000000000002'); end if;

  perform public.t_as('30000000-0000-0000-0000-000000000002');
  perform public.t_ok(format('select public.save_push_token(%L, %L, %L)', gid, 'phone-token-U-123', 'android'));
  perform public.t_ok(format('select public.save_push_token(%L, %L, %L)', gid, 'phone-token-U-123', 'android')); -- again: no duplicate
  perform public.t_err('select count(*) from public.push_tokens', 'permission denied');           -- nobody reads the table
  perform public.t_err(format('select public.save_push_token(%L, %L)', gid, 'short'), 'INVALID_TOKEN');

  -- someone outside the mess cannot register for it
  perform public.t_as('30000000-0000-0000-0000-000000000003');
  perform public.t_err(format('select public.save_push_token(%L, %L)', gid, 'outsider-token-123'), 'FORBIDDEN');
  -- … and cannot delete someone else's phone
  perform public.t_ok(format('select public.delete_push_token(%L)', 'phone-token-U-123'));
  -- clients cannot fake pushed_at
  perform public.t_err(format('update public.activity_log set pushed_at = now() where group_id = %L', gid), 'permission denied');
end $$;
reset role;
select public.t_eq('select count(*)::text from public.push_tokens where token = ''phone-token-U-123''', '1');
select public.t_eq('select user_id::text from public.push_tokens where token = ''phone-token-U-123''', '30000000-0000-0000-0000-000000000002');
do $$ begin
  perform public.t_as('30000000-0000-0000-0000-000000000002');
  perform public.delete_push_token('phone-token-U-123');                                         -- sign out
end $$;
reset role;
select public.t_eq('select count(*)::text from public.push_tokens', '0');
-- anon cannot call the functions at all
set role anon;
select public.t_err('select public.save_push_token(gen_random_uuid(), ''anon-token-12345'')', 'permission denied');
reset role;
\echo 'PUSH TESTS PASSED'
