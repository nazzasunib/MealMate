\set ON_ERROR_STOP 1
-- Super Admin rules (run after stub_supabase.sql, 0001_mealmate.sql, 0002_super_admin.sql)
-- Scenario: 7 people — S (Super Admin/creator), A1, A2 (Admins), M1, M2 (Moderators), U1, U2 (Members).
set client_min_messages = notice;

create or replace function public.t_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end $$;
create or replace function public.t_ok(p_sql text) returns void language plpgsql as $$
begin execute p_sql; raise notice 'OK (allowed): %', left(p_sql, 90); end $$;
create or replace function public.t_err(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm ~* p_pattern then raise notice 'OK (blocked %): %', sqlerrm, left(p_sql, 80); return; end if;
    raise exception 'Unexpected error for [%]: %', p_sql, sqlerrm;
  end;
  raise exception 'Expected "%" but it succeeded: %', p_pattern, p_sql;
end $$;
create or replace function public.t_eq(p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  if v is distinct from p_expected then raise exception 'Expected [%] got [%] for %', p_expected, v, p_sql; end if;
  raise notice 'OK = %: %', v, left(p_sql, 80);
end $$;
grant execute on function public.t_as(uuid), public.t_ok(text), public.t_err(text,text), public.t_eq(text,text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 's@x.com',  '{"full_name":"Super"}'),
  ('10000000-0000-0000-0000-000000000002', 'a1@x.com', '{"full_name":"Admin1"}'),
  ('10000000-0000-0000-0000-000000000003', 'a2@x.com', '{"full_name":"Admin2"}'),
  ('10000000-0000-0000-0000-000000000004', 'm1@x.com', '{"full_name":"Mod1"}'),
  ('10000000-0000-0000-0000-000000000005', 'm2@x.com', '{"full_name":"Mod2"}'),
  ('10000000-0000-0000-0000-000000000006', 'u1@x.com', '{"full_name":"User1"}'),
  ('10000000-0000-0000-0000-000000000007', 'u2@x.com', '{"full_name":"User2"}'),
  ('10000000-0000-0000-0000-000000000008', 'z@x.com',  '{"full_name":"Other"}');

-- S creates the mess -> S is Super Admin
select public.t_as('10000000-0000-0000-0000-000000000001');
create temp table g as select (public.create_meal_group('Test Mess', 'Super'))::json as j;
grant select on g to authenticated;
select public.t_eq($$select (public.get_my_membership())->>'is_super_admin'$$, 'true');

-- everyone else joins and S approves them
do $$ declare u uuid; code text; gid uuid; begin
  select (j->>'invite_code'), (j->>'group_id')::uuid into code, gid from g;
  foreach u in array array['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',
                           '10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007']::uuid[] loop
    perform public.t_as(u); perform public.join_meal_group(code);
    perform public.t_as('10000000-0000-0000-0000-000000000001');
    if exists (select 1 from public.list_join_requests(gid)) then perform public.approve_join_request(gid, u); end if;
  end loop;
end $$;

-- S (Super Admin) sets up roles: A1, A2 Admin; M1, M2 Moderator
select public.t_as('10000000-0000-0000-0000-000000000001');
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000002','ADMIN')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000003','ADMIN')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000004','MODERATOR')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000005','MODERATOR')$$, (select j->>'group_id' from g)));
select public.t_eq(format($$select count(*)::text from public.list_group_accounts(%L)$$, (select j->>'group_id' from g)), '7');
select public.t_eq(format($$select string_agg(full_name || ':' || role || case when is_super_admin then '*' else '' end, ',' order by full_name) from public.list_group_accounts(%L)$$, (select j->>'group_id' from g)),
  'Admin1:ADMIN,Admin2:ADMIN,Mod1:MODERATOR,Mod2:MODERATOR,Super:ADMIN*,User1:MEMBER,User2:MEMBER');
select public.t_eq(format($$select full_name from public.list_group_accounts(%L) limit 1$$, (select j->>'group_id' from g)), 'Super'); -- Super Admin listed first

-- Nobody can change or remove the Super Admin (not even themselves via role change)
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000001','MEMBER')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_PROTECTED');
select public.t_as('10000000-0000-0000-0000-000000000002');  -- A1
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000001','MEMBER')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_PROTECTED');
select public.t_err(format($$select public.remove_group_member(%L,'10000000-0000-0000-0000-000000000001')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_PROTECTED');

-- Admins can't change / remove other Admins, and can't make new Admins
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000003','MEMBER')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY');
select public.t_err(format($$select public.remove_group_member(%L,'10000000-0000-0000-0000-000000000003')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY');
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000006','ADMIN')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY');
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000002','MEMBER')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY'); -- not even self
-- ...but Admins still manage Moderators and Members
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000006','MODERATOR')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000006','MEMBER')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000005','MEMBER')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000005','MODERATOR')$$, (select j->>'group_id' from g)));
-- Admin can't transfer Super Admin
select public.t_err(format($$select public.transfer_super_admin(%L,'10000000-0000-0000-0000-000000000002')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY');

-- Moderators can't change anyone (incl. other Moderators)
select public.t_as('10000000-0000-0000-0000-000000000004');  -- M1
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000005','MEMBER')$$, (select j->>'group_id' from g)), 'FORBIDDEN');
select public.t_err(format($$select public.remove_group_member(%L,'10000000-0000-0000-0000-000000000005')$$, (select j->>'group_id' from g)), 'FORBIDDEN');

-- Direct table writes are impossible
update public.group_members set is_super_admin = true, role = 'ADMIN' where user_id = auth.uid();
reset role;
select public.t_eq($$select (is_super_admin or role = 'ADMIN')::text from public.group_members where user_id = '10000000-0000-0000-0000-000000000004'$$, 'false');
select public.t_as('10000000-0000-0000-0000-000000000004');
select public.t_err($$select public._ensure_super_admin(gen_random_uuid())$$, 'permission denied');

-- Super Admin can demote / remove Admins
select public.t_as('10000000-0000-0000-0000-000000000001');
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000003','MODERATOR')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000003','ADMIN')$$, (select j->>'group_id' from g)));
select public.t_ok(format($$select public.remove_group_member(%L,'10000000-0000-0000-0000-000000000007')$$, (select j->>'group_id' from g)));
-- can't transfer to someone outside the mess
select public.t_err(format($$select public.transfer_super_admin(%L,'10000000-0000-0000-0000-000000000008')$$, (select j->>'group_id' from g)), 'NOT_A_MEMBER');

-- Transfer: S -> U1 (a Member). U1 becomes Admin + Super Admin; S stays Admin.
select public.t_ok(format($$select public.transfer_super_admin(%L,'10000000-0000-0000-0000-000000000006')$$, (select j->>'group_id' from g)));
select public.t_eq($$select concat((public.get_my_membership())->>'role', '/', (public.get_my_membership())->>'is_super_admin')$$, 'ADMIN/false');
select public.t_err(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000002','MEMBER')$$, (select j->>'group_id' from g)), 'SUPER_ADMIN_ONLY'); -- S is now a regular Admin
select public.t_as('10000000-0000-0000-0000-000000000006');
select public.t_eq($$select concat((public.get_my_membership())->>'role', '/', (public.get_my_membership())->>'is_super_admin')$$, 'ADMIN/true');
select public.t_ok(format($$select public.change_member_role(%L,'10000000-0000-0000-0000-000000000001','MEMBER')$$, (select j->>'group_id' from g))); -- new Super Admin manages old one
reset role;
select public.t_eq($$select count(*)::text from public.group_members where is_super_admin$$, '1');

-- Account deletion of the Super Admin hands the title on automatically (creator S is only a Member now -> creator still preferred)
delete from auth.users where id = '10000000-0000-0000-0000-000000000006';
select public.t_eq($$select p.full_name from public.group_members gm join public.profiles p on p.id = gm.user_id where gm.is_super_admin$$, 'Super');
select public.t_eq($$select role from public.group_members where user_id = '10000000-0000-0000-0000-000000000001'$$, 'ADMIN');

-- Backfill: a legacy mess with no Super Admin gets its creator
update public.group_members set is_super_admin = false;
select public._ensure_super_admin(id) from public.meal_groups;
select public.t_eq($$select p.full_name from public.group_members gm join public.profiles p on p.id = gm.user_id where gm.is_super_admin$$, 'Super');
select 'ALL SUPER ADMIN TESTS PASSED' as result;
