\set ON_ERROR_STOP 1
-- shopping list assignment + notices (run after stub_supabase.sql, 0001 … 0006 and
-- the helpers at the top of test_activity_requests.sql: t_as/t_ok/t_err/t_eq)
set client_min_messages = notice;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-000000000001', 'sa@x.com', '{"full_name":"Shop Admin"}'),
  ('40000000-0000-0000-0000-000000000002', 'sm@x.com', '{"full_name":"Shop Member"}'),
  ('40000000-0000-0000-0000-000000000003', 'so@x.com', '{"full_name":"Outsider"}');
select public.t_as('40000000-0000-0000-0000-000000000001');
create temp table sg as select (public.create_meal_group('Shop Mess', 'Shop Admin'))::json as j;
grant select on sg to authenticated;
do $$ declare code text; gid uuid; mid text; nid uuid; begin
  select (j->>'invite_code'), (j->>'group_id')::uuid into code, gid from sg;
  perform public.t_as('40000000-0000-0000-0000-000000000002'); perform public.join_meal_group(code);
  perform public.t_as('40000000-0000-0000-0000-000000000001');
  if exists (select 1 from public.list_join_requests(gid)) then perform public.approve_join_request(gid, '40000000-0000-0000-0000-000000000002'); end if;
  select id into mid from public.members where group_id = gid and user_id = '40000000-0000-0000-0000-000000000002';

  -- member cannot assign, admin can
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_err(format('select public.set_shopping_plan(%L, array[%L], public._mess_today() + 2)', gid, mid), 'FORBIDDEN');
  perform public.t_as('40000000-0000-0000-0000-000000000001');
  perform public.t_err(format('select public.set_shopping_plan(%L, array[%L], public._mess_today() - 1)', gid, mid), 'PAST_DATE');
  perform public.t_err(format('select public.set_shopping_plan(%L, array[%L], public._mess_today() + 2)', gid, 'nobody'), 'NO_MEMBERS');
  perform public.t_ok(format('select public.set_shopping_plan(%L, array[%L, %L], public._mess_today() + 2, %L)', gid, mid, 'nobody', 'before lunch'));
  -- member sees the plan, outsider does not
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_eq(format('select array_to_string(member_ids, %L) from public.shopping_plans where group_id = %L', ',', gid), mid);
  perform public.t_eq('select count(*)::text from public.activity_log where kind = ''shopping'' and action = ''assigned''', '1');
  perform public.t_as('40000000-0000-0000-0000-000000000003');
  perform public.t_eq('select count(*)::text from public.shopping_plans', '0');
  perform public.t_err(format('select public.sweep_shopping(%L)', gid), 'FORBIDDEN');
  -- sweep does nothing before the close date
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_eq(format('select public.sweep_shopping(%L)::text', gid), 'false');
end $$;

-- items on the list, then move the close date into the past (as the owner) and sweep
reset role;
do $$ declare gid uuid; begin
  select (j->>'group_id')::uuid into gid from sg;
  insert into public.shopping_items (group_id, id, category, item, quantity, checked) values (gid, 's1', 'Grocery', 'Rice', '5 kg', false), (gid, 's2', 'Grocery', 'Dal', '1 kg', true);
  update public.shopping_plans set close_date = public._mess_today() - 1 where group_id = gid;
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_eq(format('select public.sweep_shopping(%L)::text', gid), 'true');
  perform public.t_eq(format('select public.sweep_shopping(%L)::text', gid), 'false');
end $$;
reset role;
select public.t_eq('select count(*)::text from public.shopping_items where group_id = (select (j->>''group_id'')::uuid from sg)', '0');
select public.t_eq('select count(*)::text from public.shopping_plans', '0');

-- notices
do $$ declare gid uuid; nid uuid; begin
  select (j->>'group_id')::uuid into gid from sg;
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_err(format('select public.create_notice(%L, %L, %L)', gid, 'Hi', 'x'), 'FORBIDDEN');
  perform public.t_as('40000000-0000-0000-0000-000000000001');
  perform public.t_err(format('select public.create_notice(%L, %L, %L)', gid, '  ', 'x'), 'TITLE_REQUIRED');
  nid := public.create_notice(gid, 'Water off Friday', 'No water 10am-2pm');
  perform public.update_notice(nid, 'Water off Saturday', 'Changed day');
  perform public.t_as('40000000-0000-0000-0000-000000000002');
  perform public.t_eq('select title from public.notices', 'Water off Saturday');
  perform public.t_err(format('select public.update_notice(%L, %L, %L)', nid, 'x', 'y'), 'FORBIDDEN');
  perform public.t_err(format('select public.delete_notice(%L)', nid), 'FORBIDDEN');
  perform public.t_err(format('insert into public.notices (group_id, title) values (%L, %L)', gid, 'sneaky'), 'permission denied');
  perform public.t_eq('select string_agg(action, '','' order by id) from public.activity_log where kind = ''notice''', 'posted,updated');
  perform public.t_as('40000000-0000-0000-0000-000000000003');
  perform public.t_eq('select count(*)::text from public.notices', '0');
  perform public.t_as('40000000-0000-0000-0000-000000000001');
  perform public.delete_notice(nid);
end $$;
reset role;
select public.t_eq('select count(*)::text from public.notices', '0');
\echo 'SHOPPING + NOTICE TESTS PASSED'
