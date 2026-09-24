\set ON_ERROR_STOP 1
-- helpers ------------------------------------------------------------
create or replace function public.t_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end $$;
create or replace function public.t_expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~* p_pattern then
      raise notice 'OK (blocked): % -> %', left(p_sql, 70), sqlerrm;
      return;
    end if;
    raise exception 'Unexpected error for [%]: %', p_sql, sqlerrm;
  end;
  raise exception 'Expected error "%" but statement succeeded: %', p_pattern, p_sql;
end $$;
create or replace function public.t_expect_rows(p_sql text, p_n int) returns void language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  if n <> p_n then raise exception 'Expected % rows, got % for %', p_n, n, p_sql; end if;
  raise notice 'OK rows=%: %', n, left(p_sql, 80);
end $$;
grant execute on function public.t_as(uuid), public.t_expect_error(text,text), public.t_expect_rows(text,int) to authenticated, anon;

-- users --------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'nazzas@example.com', '{"full_name":"Nazzas"}'),
  ('00000000-0000-0000-0000-00000000000b', 'rahim@example.com',  '{"full_name":"Rahim"}'),
  ('00000000-0000-0000-0000-00000000000c', 'karim@example.com',  '{"full_name":"Karim"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dina@example.com',   '{"full_name":"Dina"}'),
  ('00000000-0000-0000-0000-00000000000e', 'sakib@example.com',  '{}');

select public.t_expect_rows('select 1 from public.profiles', 5);  -- trigger created profiles (as postgres)

-- A creates Group A --------------------------------------------------
select public.t_as('00000000-0000-0000-0000-00000000000a');
create temp table ga as select (public.create_meal_group('Dhaka MealMate', 'Nazzas'))::jsonb as j;
grant select on ga to public;
select j from ga;
select public.t_expect_error($$select public.create_meal_group('Second', null)$$, 'ALREADY_IN_GROUP');
select public.t_expect_rows($$select 1 from public.group_members where role='ADMIN'$$, 1);
select public.t_expect_rows($$select 1 from public.group_invites$$, 1);
select public.t_expect_rows($$select 1 from public.members$$, 1);

-- D creates Group B --------------------------------------------------
reset role;
select public.t_as('00000000-0000-0000-0000-00000000000d');
create temp table gb as select (public.create_meal_group('Chittagong Mess', 'Dina'))::jsonb as j;
grant select on gb to public;
select public.t_expect_rows($$select 1 from public.meal_groups$$, 1); -- D sees only own group
select public.t_expect_error($$select public.create_meal_group('x', null)$$, 'INVALID_GROUP_NAME|ALREADY_IN_GROUP');

-- anon preview -------------------------------------------------------
reset role;
select set_config('role','anon',false);
select public.get_invite_preview((select j->>'invite_code' from ga));
select public.get_invite_preview('mm7k29px') is null as invalid_is_null;
select public.t_expect_error($$select * from public.members$$, 'permission denied');
reset role;

-- B joins A as MEMBER ; C joins A ; E joins A --------------------------
select public.t_as('00000000-0000-0000-0000-00000000000b');
select (public.join_meal_group('MM-ZZZZZZ'))->>'error' = 'INVALID_INVITE' as invalid_invite_ok;
select public.join_meal_group(lower(replace((select j->>'invite_code' from ga), '-', '')));  -- tolerant format
select public.t_expect_error(format($$select public.join_meal_group(%L)$$, (select j->>'invite_code' from ga)), 'ALREADY_MEMBER');
select public.t_expect_error(format($$select public.join_meal_group(%L)$$, (select j->>'invite_code' from gb)), 'ALREADY_IN_GROUP');
select (public.get_my_membership())->>'role' as b_role;
-- B cannot self-promote in any way
select public.t_expect_error(format($$select public.change_member_role(%L, %L, 'ADMIN')$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000b'), 'FORBIDDEN');
update public.group_members set role='ADMIN'; -- filtered by RLS (no update policy)
select public.t_expect_rows($$select 1 from public.group_members where role='ADMIN' and user_id=auth.uid()$$, 0);
select public.t_expect_error($$insert into public.group_members(group_id,user_id,role) select id, auth.uid(), 'ADMIN' from public.meal_groups$$, 'row-level security|violates|duplicate');
-- member can't read invite code, can't write data
select public.t_expect_rows($$select 1 from public.group_invites$$, 0);
select public.t_expect_error(format($$insert into public.expenses(group_id,id,date,amount) values (%L,'exp_x','2026-09-01',100)$$, (select j->>'group_id' from ga)), 'row-level security');
select public.t_expect_error($$select public.list_group_accounts((select id from public.meal_groups))$$, 'FORBIDDEN');
reset role;

select public.t_as('00000000-0000-0000-0000-00000000000c');
select public.join_meal_group((select j->>'invite_code' from ga));
reset role;
select public.t_as('00000000-0000-0000-0000-00000000000e');
select public.join_meal_group((select j->>'invite_code' from ga));
reset role;

-- Admin A manages roles ---------------------------------------------
select public.t_as('00000000-0000-0000-0000-00000000000a');
select public.t_expect_rows(format($$select * from public.list_group_accounts(%L)$$, (select j->>'group_id' from ga)), 4);
select public.change_member_role((select (j->>'group_id')::uuid from ga), '00000000-0000-0000-0000-00000000000b', 'MODERATOR');
select public.t_expect_error(format($$select public.change_member_role(%L, %L, 'MEMBER')$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000a'), 'LAST_ADMIN');
select public.t_expect_error(format($$select public.remove_group_member(%L, %L)$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000a'), 'LAST_ADMIN');
select public.t_expect_error(format($$select public.change_member_role(%L, %L, 'OWNER')$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000c'), 'INVALID_ROLE');
-- A cannot touch group B
select public.t_expect_error(format($$select public.change_member_role(%L, %L, 'MEMBER')$$, (select j->>'group_id' from gb), '00000000-0000-0000-0000-00000000000d'), 'FORBIDDEN');
select public.t_expect_error(format($$select public.regenerate_invite_code(%L)$$, (select j->>'group_id' from gb)), 'FORBIDDEN');
-- A writes data
insert into public.members(group_id,id,name) values ((select (j->>'group_id')::uuid from ga), 'mem_extra', 'Hasan');
insert into public.expenses(group_id,id,date,amount,items,buyer_ids) values ((select (j->>'group_id')::uuid from ga), 'exp_1', '2026-09-01', 250.5, '[{"item":"Rice","amount":250.5}]', array['mem_extra']);
insert into public.deposits(group_id,id,member_id,date,amount) values ((select (j->>'group_id')::uuid from ga), 'dep_1', 'mem_extra', '2026-09-01', 1000);
insert into public.store_carry_forward(group_id,month_key,from_month_key,item,unit,quantity) values ((select (j->>'group_id')::uuid from ga),'2026-10','2026-09','Rice','kg',2);
-- upsert (what the app does)
insert into public.expenses(group_id,id,date,amount) values ((select (j->>'group_id')::uuid from ga), 'exp_1', '2026-09-02', 300)
  on conflict (group_id,id) do update set date=excluded.date, amount=excluded.amount;
-- A cannot write into group B
select public.t_expect_error(format($$insert into public.expenses(group_id,id,date,amount) values (%L,'exp_b','2026-09-01',1)$$, (select j->>'group_id' from gb)), 'row-level security');
-- new invite code invalidates old
create temp table oldcode as select j->>'invite_code' as c from ga;
reset role; grant select on oldcode to public; select public.t_as('00000000-0000-0000-0000-00000000000a');
select public.regenerate_invite_code((select (j->>'group_id')::uuid from ga)) as new_code;
reset role;

-- Moderator B -------------------------------------------------------
select public.t_as('00000000-0000-0000-0000-00000000000b');
insert into public.expenses(group_id,id,date,amount) values ((select (j->>'group_id')::uuid from ga), 'exp_mod', '2026-09-03', 50);
insert into public.meals(group_id,member_id,date,breakfast,lunch,dinner) values ((select (j->>'group_id')::uuid from ga),'mem_extra','2026-09-03',true,true,false);
insert into public.shopping_items(group_id,id,category,item) values ((select (j->>'group_id')::uuid from ga),'shop_1','Grocery','Rice');
insert into public.store_carry_forward(group_id,month_key,from_month_key,item,unit,quantity) values ((select (j->>'group_id')::uuid from ga),'2026-09','manual','Rice','kg',-1);
update public.expenses set amount = 1 where id='exp_1'; -- silently filtered by RLS
select public.t_expect_rows($$select 1 from public.expenses where id='exp_1' and amount = 300$$, 1);
select public.t_expect_error(format($$insert into public.deposits(group_id,id,member_id,date,amount) values (%L,'dep_m','mem_extra','2026-09-01',5)$$, (select j->>'group_id' from ga)), 'row-level security');
select public.t_expect_error(format($$insert into public.settlements(group_id,month_key) values (%L,'2026-09')$$, (select j->>'group_id' from ga)), 'row-level security');
select public.t_expect_error(format($$insert into public.store_carry_forward(group_id,month_key,from_month_key,item,unit,quantity) values (%L,'2026-11','2026-10','Oil','L',1)$$, (select j->>'group_id' from ga)), 'row-level security');
select public.t_expect_error(format($$select public.change_member_role(%L, %L, 'ADMIN')$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000b'), 'FORBIDDEN');
select public.t_expect_error(format($$select public.remove_group_member(%L, %L)$$, (select j->>'group_id' from ga), '00000000-0000-0000-0000-00000000000c'), 'FORBIDDEN');
select public.t_expect_rows(format($$select * from public.list_group_accounts(%L)$$, (select j->>'group_id' from ga)), 4);
select public.t_expect_rows($$select 1 from public.group_invites$$, 0);
reset role;

-- B deletes are no-ops (RLS filters) -> verify exp_1 still exists
select public.t_as('00000000-0000-0000-0000-00000000000b');
delete from public.expenses where id = 'exp_1';
select public.t_expect_rows($$select 1 from public.expenses where id='exp_1'$$, 1);
reset role;

-- Cross-group isolation: D sees nothing of group A --------------------
select public.t_as('00000000-0000-0000-0000-00000000000d');
select public.t_expect_rows($$select 1 from public.expenses$$, 0);
select public.t_expect_rows($$select 1 from public.members where name <> 'Dina'$$, 0);
select public.t_expect_rows($$select 1 from public.profiles$$, 1);
select (public.join_meal_group((select c from oldcode)))->>'error' = 'INVALID_INVITE' as d_old_code;
reset role;

-- Old invite code rejected for a fresh user ---------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'new@example.com');
select public.t_as('00000000-0000-0000-0000-00000000000f');
select (public.join_meal_group((select c from oldcode)))->>'error' = 'INVALID_INVITE' as old_code_rejected;
-- brute force: 20 wrong codes -> locked out
do $$ begin for i in 1..19 loop perform public.join_meal_group('MM-QQQQQ' || i % 10); end loop; end $$;
select public.t_expect_error($$select public.join_meal_group('MM-QQQQQQ')$$, 'TOO_MANY_ATTEMPTS');
reset role;

-- Promote second admin, then demote first is allowed; remove works ---
select public.t_as('00000000-0000-0000-0000-00000000000a');
select public.change_member_role((select (j->>'group_id')::uuid from ga), '00000000-0000-0000-0000-00000000000c', 'ADMIN');
select public.change_member_role((select (j->>'group_id')::uuid from ga), '00000000-0000-0000-0000-00000000000a', 'MEMBER');
reset role;
select public.t_as('00000000-0000-0000-0000-00000000000c');
select public.remove_group_member((select (j->>'group_id')::uuid from ga), '00000000-0000-0000-0000-00000000000e');
select public.t_expect_rows($$select 1 from public.members where status='INACTIVE'$$, 1);
select public.set_invite_enabled((select (j->>'group_id')::uuid from ga), false);
reset role;
create temp table newcode as select code as c from public.group_invites where group_id = (select (j->>'group_id')::uuid from ga);
grant select on newcode to public;
reset role;
select public.t_as('00000000-0000-0000-0000-00000000000e');
select public.t_expect_error(format($$select public.join_meal_group(%L)$$, (select c from newcode)), 'INVITE_DISABLED');
select public.get_my_membership() is null as removed_user_has_no_group;
select public.t_expect_rows($$select 1 from public.expenses$$, 0);
reset role;
select 'ALL TESTS PASSED' as result;
