-- =====================================================================
-- MealMate 0009 — Meal Off request, date wise
--
-- A member can ask for meal off over a date range and pick the meals
-- separately for every date (e.g. Oct 20 only Breakfast off, Oct 24 only
-- Lunch off). Admins / Moderators see the date wise list on the request
-- and approve or reject it with one click.
--
-- 1. meal_requests.day_meals: {"2026-10-20": {"b":true,"l":false,"d":false}, ...}
--    = the meals switched OFF on that date. NULL = old style request (the
--    same meals for every day in the range).
-- 2. create_meal_request_days(): sends a date wise Meal Off request.
-- 3. decide_meal_request(): same name and arguments as before; approving
--    now also understands day_meals.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.meal_requests add column if not exists day_meals jsonb;

-- "Oct 20 – Oct 24 · date wise (3 days)" helper text
create or replace function public._req_days_text(p_days jsonb)
returns text language sql immutable as $$
  select 'date wise (' || count(*) || case when count(*) = 1 then ' day)' else ' days)' end
    from jsonb_each(coalesce(p_days, '{}'::jsonb));
$$;

create or replace function public.create_meal_request_days(
  p_group uuid, p_from date, p_to date, p_days jsonb, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_member record;
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_days jsonb := '{}'::jsonb;
  v_k text;
  v_v jsonb;
  v_date date;
  v_min date; v_max date;
  v_b boolean := false; v_l boolean := false; v_d boolean := false;
begin
  if p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null then raise exception 'INVALID_DATE'; end if;
  if p_from < v_today then raise exception 'PAST_DATE'; end if;
  if p_to < p_from or p_to - p_from > 30 then raise exception 'INVALID_RANGE'; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'object' then raise exception 'NO_MEALS'; end if;

  -- keep only real dates inside the range that switch at least one meal off
  for v_k, v_v in select key, value from jsonb_each(p_days) loop
    begin v_date := v_k::date; exception when others then raise exception 'INVALID_DATE'; end;
    if v_date < p_from or v_date > p_to then raise exception 'INVALID_RANGE'; end if;
    if jsonb_typeof(v_v) <> 'object' then raise exception 'NO_MEALS'; end if;
    if coalesce((v_v ->> 'b')::boolean, false) or coalesce((v_v ->> 'l')::boolean, false) or coalesce((v_v ->> 'd')::boolean, false) then
      v_days := v_days || jsonb_build_object(to_char(v_date, 'YYYY-MM-DD'), jsonb_build_object(
        'b', coalesce((v_v ->> 'b')::boolean, false),
        'l', coalesce((v_v ->> 'l')::boolean, false),
        'd', coalesce((v_v ->> 'd')::boolean, false)));
    end if;
  end loop;
  if v_days = '{}'::jsonb then raise exception 'NO_MEALS'; end if;

  select min(key::date), max(key::date),
         bool_or((value ->> 'b')::boolean), bool_or((value ->> 'l')::boolean), bool_or((value ->> 'd')::boolean)
    into v_min, v_max, v_b, v_l, v_d
    from jsonb_each(v_days);

  select id, name into v_member from public.members
   where group_id = p_group and user_id = auth.uid() and status = 'ACTIVE'
   order by created_at limit 1;
  if v_member.id is null then raise exception 'NO_MEMBER_ROW'; end if;

  if exists (select 1 from public.meal_requests
              where group_id = p_group and member_id = v_member.id and status = 'PENDING' and kind = 'MEAL_OFF'
                and date_from = v_min and date_to = v_max and day_meals is not distinct from v_days) then
    raise exception 'DUPLICATE_REQUEST';
  end if;

  insert into public.meal_requests (group_id, member_id, member_name, requested_by, kind, date_from, date_to,
                                    breakfast, lunch, dinner, day_meals, note)
  values (p_group, v_member.id, left(v_member.name, 80), auth.uid(), 'MEAL_OFF', v_min, v_max,
          coalesce(v_b, false), coalesce(v_l, false), coalesce(v_d, false), v_days,
          nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;

  perform public._log_activity(p_group, 'request', 'requested',
    'requested meal off · ' || public._req_dates(v_min, v_max) || ' · ' || public._req_days_text(v_days));
  return v_id;
end;
$$;

-- Admin / Moderator approves or rejects. Same as 0004, plus date wise requests.
create or replace function public.decide_meal_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r public.meal_requests;
  v_def jsonb;
  v_d date;
  v_k text;
  v_v jsonb;
  v_b boolean; v_l boolean; v_dn boolean;
  v_summary text;
begin
  select * into r from public.meal_requests where id = p_id for update;
  if r.id is null or r.group_id not in (select public.my_group_ids()) then raise exception 'NOT_FOUND'; end if;
  if not public.has_permission(r.group_id, 'meals.edit') then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'PENDING' then raise exception 'ALREADY_DECIDED'; end if;

  if p_approve then
    select default_meals into v_def from public.members where group_id = r.group_id and id = r.member_id;
    if not found then raise exception 'MEMBER_GONE'; end if;
    if r.kind = 'MEAL_OFF' and r.day_meals is not null then
      -- date wise: each date has its own meals
      for v_k, v_v in select key, value from jsonb_each(r.day_meals) loop
        v_d := v_k::date;
        v_b := coalesce((v_v ->> 'b')::boolean, false);
        v_l := coalesce((v_v ->> 'l')::boolean, false);
        v_dn := coalesce((v_v ->> 'd')::boolean, false);
        insert into public.meals (group_id, member_id, date, breakfast, lunch, dinner, updated_by, updated_at)
        values (r.group_id, r.member_id, v_d,
                case when v_b  then false else coalesce((v_def ->> 'breakfast')::boolean, false) end,
                case when v_l  then false else coalesce((v_def ->> 'lunch')::boolean, true) end,
                case when v_dn then false else coalesce((v_def ->> 'dinner')::boolean, true) end,
                auth.uid(), now())
        on conflict (group_id, member_id, date) do update set
          breakfast  = case when v_b  then false else public.meals.breakfast end,
          lunch      = case when v_l  then false else public.meals.lunch end,
          dinner     = case when v_dn then false else public.meals.dinner end,
          updated_by = auth.uid(),
          updated_at = now();
      end loop;
    elsif r.kind = 'MEAL_OFF' then
      for v_d in select generate_series(r.date_from, r.date_to, interval '1 day')::date loop
        insert into public.meals (group_id, member_id, date, breakfast, lunch, dinner, updated_by, updated_at)
        values (r.group_id, r.member_id, v_d,
                case when r.breakfast then false else coalesce((v_def ->> 'breakfast')::boolean, false) end,
                case when r.lunch     then false else coalesce((v_def ->> 'lunch')::boolean, true) end,
                case when r.dinner    then false else coalesce((v_def ->> 'dinner')::boolean, true) end,
                auth.uid(), now())
        on conflict (group_id, member_id, date) do update set
          breakfast  = case when r.breakfast then false else public.meals.breakfast end,
          lunch      = case when r.lunch     then false else public.meals.lunch end,
          dinner     = case when r.dinner    then false else public.meals.dinner end,
          updated_by = auth.uid(),
          updated_at = now();
      end loop;
    else
      insert into public.guest_meals (group_id, id, host_member_id, guest_name, date, breakfast, lunch, dinner, quantity, note, created_by)
      values (r.group_id, 'guest_' || replace(gen_random_uuid()::text, '-', ''), r.member_id, r.guest_name, r.date_from,
              r.breakfast, r.lunch, r.dinner, r.quantity,
              left(concat_ws(' · ', 'Approved request', r.note), 500), r.requested_by);
    end if;
  end if;

  update public.meal_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         decided_by = auth.uid(), decided_name = left(public._my_name(), 120), decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where id = p_id;

  v_summary := case when p_approve then 'approved ' else 'rejected ' end || r.member_name || '''s '
    || case when r.kind = 'MEAL_OFF'
         then 'meal off request · ' || public._req_dates(r.date_from, r.date_to) || ' · '
              || case when r.day_meals is not null then public._req_days_text(r.day_meals)
                      else public._req_meals(r.breakfast, r.lunch, r.dinner) end
         else 'guest meal request · ' || public._req_dates(r.date_from, r.date_from) || ' · ' || public._req_meals(r.breakfast, r.lunch, r.dinner)
              || case when r.quantity > 1 then ' ×' || r.quantity else '' end end
    || coalesce(' — "' || nullif(btrim(coalesce(p_note, '')), '') || '"', '');
  perform public._log_activity(r.group_id, 'request', case when p_approve then 'approved' else 'rejected' end, v_summary, r.requested_by);
end;
$$;

revoke all on function public.create_meal_request_days(uuid, date, date, jsonb, text) from public, anon;
revoke all on function public.decide_meal_request(uuid, boolean, text) from public, anon;
grant execute on function public.create_meal_request_days(uuid, date, date, jsonb, text) to authenticated;
grant execute on function public.decide_meal_request(uuid, boolean, text) to authenticated;
