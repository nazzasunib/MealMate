\set ON_ERROR_STOP 1
-- delete_roster_member (run after stub_supabase.sql, 0001, 0002, 0003)
-- People: S = Super Admin, A = Admin, A2 = Admin, U = Member (with account), V = Member (with account),
--         R = roster-only member (no login), Q = roster-only member (no login).
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
  ('20000000-0000-0000-0000-000000000001', 's@x.com',  '{"full_name":"Super"}'),
  ('20000000-0000-0000-0000-000000000002', 'a@x.com',  '{"full_name":"AdminA"}'),
  ('20000000-0000-0000-0000-000000000003', 'a2@x.com', '{"full_name":"AdminB"}'),
  ('20000000-0000-0000-0000-000000000004', 'u@x.com',  '{"full_name":"UserU"}'),
  ('20000000-0000-0000-0000-000000000005', 'v@x.com',  '{"full_name":"UserV"}');

select public.t_as('20000000-0000-0000-0000-000000000001');
create temp table g as select (public.create_meal_group('Del Mess', 'Super'))::json as j;
grant select on g to authenticated;
do $$ declare u uuid; code text; gid uuid; begin
  select (j->>'invite_code'), (j->>'group_id')::uuid into code, gid from g;
  foreach u in array array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',
                           '20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005']::uuid[] loop
    perform public.t_as(u); perform public.join_meal_group(code);
    perform public.t_as('20000000-0000-0000-0000-000000000001');
    if exists (select 1 from public.list_join_requests(gid)) then perform public.approve_join_request(gid, u); end if;
  end loop;
  perform public.change_member_role(gid, '20000000-0000-0000-0000-000000000002', 'ADMIN');
  perform public.change_member_role(gid, '20000000-0000-0000-0000-000000000003', 'ADMIN');
end $$;

-- roster-only members + data for everyone (as the database owner)
reset role;
do $$ declare gid uuid; mu text; mv text; begin
  select (j->>'group_id')::uuid into gid from g;
  insert into public.members (group_id, id, name) values (gid, 'mem_R', 'Roster R'), (gid, 'mem_Q', 'Roster Q');
  select id into mu from public.members where group_id = gid and user_id = '20000000-0000-0000-0000-000000000004';
  select id into mv from public.members where group_id = gid and user_id = '20000000-0000-0000-0000-000000000005';
  create temp table ids (k text primary key, v text); grant select on ids to authenticated;
  insert into ids values ('U', mu), ('V', mv),
    ('S', (select id from public.members where group_id = gid and user_id = '20000000-0000-0000-0000-000000000001')),
    ('A', (select id from public.members where group_id = gid and user_id = '20000000-0000-0000-0000-000000000002')),
    ('A2',(select id from public.members where group_id = gid and user_id = '20000000-0000-0000-0000-000000000003'));
  insert into public.meals (group_id, member_id, date, lunch) values (gid, 'mem_R', '2026-09-01', true), (gid, 'mem_Q', '2026-09-01', true), (gid, mu, '2026-09-01', true);
  insert into public.deposits (group_id, id, member_id, date, amount) values (gid, 'd_R', 'mem_R', '2026-09-01', 500), (gid, 'd_Q', 'mem_Q', '2026-09-01', 700), (gid, 'd_U', mu, '2026-09-01', 300);
  insert into public.guest_meals (group_id, id, host_member_id, date, lunch) values (gid, 'gm_Q', 'mem_Q', '2026-09-01', true);
end $$;
grant select on ids to authenticated;

-- Members / Moderators can't delete
select public.t_as('20000000-0000-0000-0000-000000000005');  -- V (member)
select public.t_err(format($$select public.delete_roster_member(%L,'mem_R',true)$$, (select j->>'group_id' from g)), 'FORBIDDEN');

-- Regular Admin A
select public.t_as('20000000-0000-0000-0000-000000000002');
select public.t_err(format($$select public.delete_roster_member(%L,%L,true)$$, (select j->>'group_id' from g), (select v from ids where k='S')), 'SUPER_ADMIN_PROTECTED');
select public.t_err(format($$select public.delete_roster_member(%L,%L,true)$$, (select j->>'group_id' from g), (select v from ids where k='A2')), 'SUPER_ADMIN_ONLY');
select public.t_err(format($$select public.delete_roster_member(%L,%L,true)$$, (select j->>'group_id' from g), (select v from ids where k='A')), 'CANNOT_REMOVE_SELF');
select public.t_err(format($$select public.delete_roster_member(%L,'mem_nope',true)$$, (select j->>'group_id' from g)), 'NOT_A_MEMBER');
-- A deletes U, keeping data: U loses access, U's deposit & meal stay
select public.t_ok(format($$select public.delete_roster_member(%L,%L,true)$$, (select j->>'group_id' from g), (select v from ids where k='U')));
-- A deletes roster-only R, keeping data
select public.t_ok(format($$select public.delete_roster_member(%L,'mem_R',true)$$, (select j->>'group_id' from g)));
-- A deletes roster-only Q with everything
select public.t_ok(format($$select public.delete_roster_member(%L,'mem_Q',false)$$, (select j->>'group_id' from g)));

reset role;
select public.t_eq($$select count(*)::text from public.group_members where user_id = '20000000-0000-0000-0000-000000000004'$$, '0');   -- U lost access
select public.t_eq($$select count(*)::text from public.members where id in ('mem_R','mem_Q') or user_id = '20000000-0000-0000-0000-000000000004'$$, '0');
select public.t_eq($$select string_agg(id, ',' order by id) from public.deposits$$, 'd_R,d_U');   -- kept for R and U, Q's gone
select public.t_eq($$select count(*)::text from public.meals where member_id = 'mem_Q'$$, '0');
select public.t_eq($$select count(*)::text from public.meals where member_id = 'mem_R'$$, '1');
select public.t_eq($$select count(*)::text from public.guest_meals$$, '0');
select public.t_eq($$select sum(amount)::text from public.deposits$$, '800.00');  -- money totals only drop by Q's deposit

-- Super Admin can delete an Admin (with everything); still can't delete self
select public.t_as('20000000-0000-0000-0000-000000000001');
select public.t_ok(format($$select public.delete_roster_member(%L,%L,false)$$, (select j->>'group_id' from g), (select v from ids where k='A2')));
select public.t_err(format($$select public.delete_roster_member(%L,%L,false)$$, (select j->>'group_id' from g), (select v from ids where k='S')), 'CANNOT_REMOVE_SELF');
reset role;
select public.t_eq($$select count(*)::text from public.group_members where user_id = '20000000-0000-0000-0000-000000000003'$$, '0');
select public.t_eq($$select count(*)::text from public.group_members where is_super_admin$$, '1');
select 'ALL DELETE MEMBER TESTS PASSED' as result;
