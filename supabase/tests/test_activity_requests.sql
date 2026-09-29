\set ON_ERROR_STOP 1
-- activity feed + meal requests (run after stub_supabase.sql, 0001, 0002, 0003, 0004)
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
create temp table g as select (public.create_meal_group('Req Mess', 'Super'))::json as j;
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
  perform public.change_member_role(gid, '20000000-0000-0000-0000-000000000003', 'MODERATOR');
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
  insert into public.meals (group_id, member_id, date, breakfast, lunch, dinner) values (gid, mu, (now() at time zone 'Asia/Dhaka')::date + 2, true, true, true);
  insert into public.deposits (group_id, id, member_id, date, amount) values (gid, 'd_R', 'mem_R', '2026-09-01', 500), (gid, 'd_Q', 'mem_Q', '2026-09-01', 700), (gid, 'd_U', mu, '2026-09-01', 300);
  insert into public.guest_meals (group_id, id, host_member_id, date, lunch) values (gid, 'gm_Q', 'mem_Q', '2026-09-01', true);
end $$;
grant select on ids to authenticated;


create temp table t (k text primary key, v text); grant all on t to authenticated;
insert into t values ('gid', (select j->>'group_id' from g));
insert into t values ('d0', ((now() at time zone 'Asia/Dhaka')::date)::text), ('d2', ((now() at time zone 'Asia/Dhaka')::date + 2)::text),
                     ('d3', ((now() at time zone 'Asia/Dhaka')::date + 3)::text), ('dm1', ((now() at time zone 'Asia/Dhaka')::date - 1)::text);

-- ===== activity feed =====
-- member V writes a line under their own name; trying to fake actor / target is impossible
select public.t_as('20000000-0000-0000-0000-000000000005');
select public.t_ok(format($$insert into public.activity_log (group_id, kind, action, summary) values (%L,'expense','added','added expense ৳500')$$, (select v from t where k='gid')));
select public.t_err(format($$insert into public.activity_log (group_id, kind, action, summary, target_user) values (%L,'expense','added','x','20000000-0000-0000-0000-000000000001')$$, (select v from t where k='gid')), 'permission denied');
select public.t_err(format($$insert into public.activity_log (group_id, kind, action, summary, actor_name) values (%L,'expense','added','x','Super')$$, (select v from t where k='gid')), 'permission denied');
select public.t_eq($$select actor_name from public.activity_log order by id desc limit 1$$, 'UserV');
select public.t_err($$update public.activity_log set summary = 'hacked'$$, 'permission denied');
select public.t_err($$delete from public.activity_log$$, 'permission denied');
-- outsider (not in group) can't read or write
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('20000000-0000-0000-0000-000000000009', 'o@x.com', '{"full_name":"Outsider"}');
select public.t_as('20000000-0000-0000-0000-000000000009');
select public.t_eq($$select count(*)::text from public.activity_log$$, '0');
select public.t_err(format($$insert into public.activity_log (group_id, kind, action, summary) values (%L,'expense','added','x')$$, (select v from t where k='gid')), 'row-level security');
select public.t_err(format($$select * from public.list_activity(%L)$$, (select v from t where k='gid')), 'FORBIDDEN');
-- 60-day sweep
reset role;
insert into public.activity_log (group_id, kind, action, summary) values ((select v::uuid from t where k='gid'), 'other', 'x', 'old line');
update public.activity_log set created_at = now() - interval '61 days' where summary = 'old line';
select public.t_as('20000000-0000-0000-0000-000000000004');
select public.t_eq(format($$select count(*)::text from public.list_activity(%L) where summary = 'old line'$$, (select v from t where k='gid')), '0');
reset role;
select public.t_eq($$select count(*)::text from public.activity_log where summary = 'old line'$$, '0');

-- ===== meal requests =====
select public.t_as('20000000-0000-0000-0000-000000000004');  -- U (member)
select public.t_err(format($$select public.create_meal_request(%L,'MEAL_OFF',%L::date,%L::date,false,true,true)$$, (select v from t where k='gid'), (select v from t where k='dm1'), (select v from t where k='dm1')), 'PAST_DATE');
select public.t_err(format($$select public.create_meal_request(%L,'MEAL_OFF',%L::date,%L::date,false,false,false)$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3')), 'NO_MEALS');
select public.t_err(format($$select public.create_meal_request(%L,'MEAL_OFF',%L::date,(%L::date + 40),false,true,true)$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d2')), 'INVALID_RANGE');
-- U: lunch + dinner off for d2..d3
insert into t select 'r1', public.create_meal_request((select v::uuid from t where k='gid'),'MEAL_OFF',(select v::date from t where k='d2'),(select v::date from t where k='d3'),false,true,true,null,1,'going home');
select public.t_err(format($$select public.create_meal_request(%L,'MEAL_OFF',%L::date,%L::date,false,true,true)$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3')), 'DUPLICATE_REQUEST');
-- U: 2 guest meals on d0 (today)
insert into t select 'r2', public.create_meal_request((select v::uuid from t where k='gid'),'GUEST',(select v::date from t where k='d0'),null,false,true,false,'Cousin',2,null);
-- V: request, then cancels it; U can't cancel V's
select public.t_as('20000000-0000-0000-0000-000000000005');
insert into t select 'r3', public.create_meal_request((select v::uuid from t where k='gid'),'MEAL_OFF',(select v::date from t where k='d2'),null,true,false,false);
select public.t_as('20000000-0000-0000-0000-000000000004');
select public.t_err(format($$select public.cancel_meal_request(%L)$$, (select v from t where k='r3')), 'FORBIDDEN');
select public.t_err(format($$select public.decide_meal_request(%L,true)$$, (select v from t where k='r1')), 'FORBIDDEN');  -- members can't approve
select public.t_as('20000000-0000-0000-0000-000000000005');
select public.t_ok(format($$select public.cancel_meal_request(%L)$$, (select v from t where k='r3')));
select public.t_eq(format($$select status from public.meal_requests where id = %L$$, (select v from t where k='r3')), 'CANCELLED');
-- nobody can write the table directly
select public.t_err(format($$update public.meal_requests set status='APPROVED' where id = %L$$, (select v from t where k='r1')), 'permission denied');
select public.t_err(format($$insert into public.meal_requests (group_id, member_id, kind, date_from, date_to, lunch) values (%L,'x','GUEST',current_date,current_date,true)$$, (select v from t where k='gid')), 'permission denied');

-- Moderator A2 approves U's meal off: d2 existed (B/L/D on) -> breakfast stays on; d3 had no row -> default (B off, L/D) with L/D off
select public.t_as('20000000-0000-0000-0000-000000000003');
select public.t_ok(format($$select public.decide_meal_request(%L,true)$$, (select v from t where k='r1')));
select public.t_eq(format($$select breakfast||','||lunch||','||dinner from public.meals where member_id=%L and date=%L::date$$, (select v from ids where k='U'), (select v from t where k='d2')), 'true,false,false');
select public.t_eq(format($$select breakfast||','||lunch||','||dinner from public.meals where member_id=%L and date=%L::date$$, (select v from ids where k='U'), (select v from t where k='d3')), 'false,false,false');
select public.t_err(format($$select public.decide_meal_request(%L,false)$$, (select v from t where k='r1')), 'ALREADY_DECIDED');
-- Admin A approves the guest request -> guest meal row, qty 2, lunch
select public.t_as('20000000-0000-0000-0000-000000000002');
select public.t_ok(format($$select public.decide_meal_request(%L,true,'ok')$$, (select v from t where k='r2')));
select public.t_eq(format($$select guest_name||'|'||quantity||'|'||lunch||'|'||breakfast from public.guest_meals where host_member_id=%L and date=%L::date$$, (select v from ids where k='U'), (select v from t where k='d0')), 'Cousin|2|true|false');
-- reject path
select public.t_as('20000000-0000-0000-0000-000000000004');
insert into t select 'r4', public.create_meal_request((select v::uuid from t where k='gid'),'MEAL_OFF',(select v::date from t where k='d3'),null,true,false,false);
select public.t_as('20000000-0000-0000-0000-000000000002');
select public.t_ok(format($$select public.decide_meal_request(%L,false,'need you that day')$$, (select v from t where k='r4')));
select public.t_eq(format($$select status||'|'||decided_name||'|'||decision_note from public.meal_requests where id=%L$$, (select v from t where k='r4')), 'REJECTED|AdminA|need you that day');
-- everyone in the group sees the feed, incl. targeted lines for U
select public.t_as('20000000-0000-0000-0000-000000000005');
select public.t_eq(format($$select count(*)::text from public.list_activity(%L) where kind='request'$$, (select v from t where k='gid')), '8');
select public.t_eq(format($$select count(*)::text from public.list_activity(%L) where target_user = '20000000-0000-0000-0000-000000000004'$$, (select v from t where k='gid')), '3');
select public.t_eq(format($$select actor_name || ': ' || summary from public.list_activity(%L) where action='approved' order by id limit 1$$, (select v from t where k='gid')),
  'AdminB: approved UserU''s meal off request · ' || to_char((select v::date from t where k='d2'),'FMMon FMDD') || ' – ' || to_char((select v::date from t where k='d3'),'FMMon FMDD') || ' · Lunch, Dinner');
reset role;
select 'ALL ACTIVITY/REQUEST TESTS PASSED' as result;
