\set ON_ERROR_STOP 1
-- date wise meal off requests (run after stub_supabase.sql, 0001-0004, 0009)
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

-- ===== date wise meal off =====
-- U asks: d2..d3 -> d2: breakfast off only (lunch + dinner stay on); d3: dinner stay on, breakfast + lunch off
select public.t_as('20000000-0000-0000-0000-000000000004');
select public.t_err(format($$select public.create_meal_request_days(%L,%L::date,%L::date,'{}'::jsonb)$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3')), 'NO_MEALS');
select public.t_err(format($$select public.create_meal_request_days(%L,%L::date,%L::date,'{"1999-01-01":{"b":true}}'::jsonb)$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3')), 'INVALID_RANGE');
select public.t_err(format($$select public.create_meal_request_days(%L,%L::date,%L::date,jsonb_build_object(%L::text, jsonb_build_object('b',true)))$$, (select v from t where k='gid'), (select v from t where k='dm1'), (select v from t where k='d3'), (select v from t where k='dm1')), 'PAST_DATE');
select public.t_err(format($$select public.create_meal_request_days(%L,%L::date,%L::date,jsonb_build_object(%L::text, jsonb_build_object('b',false,'l',false,'d',false)))$$, (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3'), (select v from t where k='d2')), 'NO_MEALS');
insert into t select 'w1', public.create_meal_request_days((select v::uuid from t where k='gid'),(select v::date from t where k='d2'),(select v::date from t where k='d3'),
  jsonb_build_object((select v from t where k='d2'), jsonb_build_object('b',true,'l',false,'d',false),
                     (select v from t where k='d3'), jsonb_build_object('b',true,'l',true,'d',false)), 'date wise');
select public.t_eq(format($$select breakfast||','||lunch||','||dinner||'|'||(day_meals is not null)::text from public.meal_requests where id=%L$$, (select v from t where k='w1')), 'true,true,false|true');
select public.t_err(format($$select public.create_meal_request_days(%L,%L::date,%L::date,jsonb_build_object(%L::text, jsonb_build_object('b',true,'l',false,'d',false),%L::text, jsonb_build_object('b',true,'l',true,'d',false)))$$,
  (select v from t where k='gid'), (select v from t where k='d2'), (select v from t where k='d3'), (select v from t where k='d2'), (select v from t where k='d3')), 'DUPLICATE_REQUEST');
-- member can't approve
select public.t_err(format($$select public.decide_meal_request(%L,true)$$, (select v from t where k='w1')), 'FORBIDDEN');
-- Moderator approves in one call
select public.t_as('20000000-0000-0000-0000-000000000003');
select public.t_ok(format($$select public.decide_meal_request(%L,true)$$, (select v from t where k='w1')));
-- d2 existed (B/L/D on): only breakfast off
select public.t_eq(format($$select breakfast||','||lunch||','||dinner from public.meals where member_id=%L and date=%L::date$$, (select v from ids where k='U'), (select v from t where k='d2')), 'false,true,true');
-- d3 had no row: default (B off, L, D on) with breakfast + lunch off -> dinner stays on
select public.t_eq(format($$select breakfast||','||lunch||','||dinner from public.meals where member_id=%L and date=%L::date$$, (select v from ids where k='U'), (select v from t where k='d3')), 'false,false,true');
select public.t_eq(format($$select status from public.meal_requests where id=%L$$, (select v from t where k='w1')), 'APPROVED');
select public.t_eq($$select count(*)::text from public.activity_log where kind='request' and summary like '%date wise (2 days)%'$$, '2');
-- reject path leaves meals alone
select public.t_as('20000000-0000-0000-0000-000000000005');
insert into t select 'w2', public.create_meal_request_days((select v::uuid from t where k='gid'),(select v::date from t where k='d2'),(select v::date from t where k='d3'),
  jsonb_build_object((select v from t where k='d3'), jsonb_build_object('b',false,'l',true,'d',true)));
select public.t_as('20000000-0000-0000-0000-000000000002');
select public.t_ok(format($$select public.decide_meal_request(%L,false,'no')$$, (select v from t where k='w2')));
select public.t_eq(format($$select count(*)::text from public.meals where member_id=%L and date=%L::date$$, (select v from ids where k='V'), (select v from t where k='d3')), '0');
-- old style requests still work after 0009
select public.t_as('20000000-0000-0000-0000-000000000004');
select public.t_ok(format($$select public.create_meal_request(%L,'MEAL_OFF',%L::date,%L::date,true,false,false)$$, (select v from t where k='gid'), (select v from t where k='d0'), (select v from t where k='d0')));
\echo ALL DATE-WISE TESTS PASSED
