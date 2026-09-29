-- =====================================================================
-- MealMate 0004 — Notifications (activity feed) + Meal requests
--
-- 1. activity_log: every change anyone in a MealMate makes (meals, guest
--    meals, expenses, money, members, shopping list, requests …) as a short
--    line. Everyone in the group can read it; each person can only add lines
--    under their OWN name (actor_id/actor_name are filled in by the database,
--    so nobody can post as someone else). Lines older than 60 days are
--    removed automatically.
-- 2. meal_requests: a member asks for "meal off" (a date or date range +
--    which meals) or a guest meal; an Admin/Moderator approves or rejects.
--    Approving applies it automatically (meals switched off / guest meal
--    added). All changes go through the functions below.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Activity feed
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  actor_name  text not null default '' check (char_length(actor_name) <= 120),
  kind        text not null check (kind in ('meal','guest','expense','deposit','member','shopping','store','month','settlement','request','team','settings','other')),
  action      text not null check (char_length(action) between 1 and 20),
  summary     text not null check (char_length(summary) between 1 and 400),
  target_user uuid,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_group_time_idx on public.activity_log (group_id, created_at desc);

-- The database decides who wrote a line: the signed-in user, with their
-- profile name. Clients cannot choose actor_id / actor_name / time.
create or replace function public._activity_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  new.actor_id := auth.uid();
  select coalesce(nullif(btrim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1), '')
    into v_name from public.profiles p where p.id = auth.uid();
  new.actor_name := left(coalesce(v_name, ''), 120);
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists activity_log_stamp on public.activity_log;
create trigger activity_log_stamp before insert on public.activity_log
  for each row execute function public._activity_stamp();

alter table public.activity_log enable row level security;
drop policy if exists activity_log_select on public.activity_log;
drop policy if exists activity_log_insert on public.activity_log;
create policy activity_log_select on public.activity_log for select to authenticated
  using (group_id in (select public.my_group_ids()));
-- plain clients may add their own lines, never targeted ones (those come from the request functions)
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (group_id in (select public.my_group_ids()) and target_user is null);
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;
grant insert (group_id, kind, action, summary) on public.activity_log to authenticated;

-- Newest first, last 60 days; also sweeps out anything older.
create or replace function public.list_activity(p_group uuid, p_limit integer default 100)
returns setof public.activity_log
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  delete from public.activity_log where group_id = p_group and created_at < now() - interval '60 days';
  return query
    select * from public.activity_log
     where group_id = p_group and created_at >= now() - interval '60 days'
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$$;

-- internal: add a line from inside the request functions (may target a user)
create or replace function public._log_activity(p_group uuid, p_kind text, p_action text, p_summary text, p_target uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (group_id, kind, action, summary, target_user)
  values (p_group, p_kind, p_action, left(p_summary, 400), p_target);
end;
$$;
revoke all on function public._log_activity(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Meal requests
-- ---------------------------------------------------------------------
create table if not exists public.meal_requests (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.meal_groups (id) on delete cascade,
  member_id     text not null check (char_length(member_id) <= 64),
  member_name   text not null default '' check (char_length(member_name) <= 80),
  requested_by  uuid references auth.users (id) on delete set null,
  kind          text not null check (kind in ('MEAL_OFF', 'GUEST')),
  date_from     date not null,
  date_to       date not null,
  breakfast     boolean not null default false,
  lunch         boolean not null default false,
  dinner        boolean not null default false,
  guest_name    text check (guest_name is null or char_length(guest_name) <= 120),
  quantity      integer not null default 1 check (quantity between 1 and 20),
  note          text check (note is null or char_length(note) <= 300),
  status        text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_name  text check (decided_name is null or char_length(decided_name) <= 120),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at    timestamptz not null default now(),
  check (breakfast or lunch or dinner),
  check (date_to >= date_from),
  check (date_to - date_from <= 30),
  check (kind = 'MEAL_OFF' or date_to = date_from)
);
create index if not exists meal_requests_group_idx on public.meal_requests (group_id, created_at desc);
create index if not exists meal_requests_pending_idx on public.meal_requests (group_id) where status = 'PENDING';

alter table public.meal_requests enable row level security;
drop policy if exists meal_requests_select on public.meal_requests;
create policy meal_requests_select on public.meal_requests for select to authenticated
  using (group_id in (select public.my_group_ids()));
-- no insert/update/delete policies: only the functions below change requests
revoke all on public.meal_requests from anon, authenticated;
grant select on public.meal_requests to authenticated;

-- "Sep 30" or "Sep 30 – Oct 2"
create or replace function public._req_dates(p_from date, p_to date)
returns text language sql immutable as $$
  select case when p_from = p_to then to_char(p_from, 'FMMon FMDD')
              else to_char(p_from, 'FMMon FMDD') || ' – ' || to_char(p_to, 'FMMon FMDD') end;
$$;
create or replace function public._req_meals(b boolean, l boolean, d boolean)
returns text language sql immutable as $$
  select concat_ws(', ', case when b then 'Breakfast' end, case when l then 'Lunch' end, case when d then 'Dinner' end);
$$;
create or replace function public._my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), split_part(coalesce(email, ''), '@', 1), '') from public.profiles where id = auth.uid();
$$;

-- A member asks for meal off / a guest meal for THEMSELVES (their own member row).
create or replace function public.create_meal_request(
  p_group uuid, p_kind text, p_from date, p_to date,
  p_breakfast boolean, p_lunch boolean, p_dinner boolean,
  p_guest_name text default null, p_quantity integer default 1, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_member record;
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_to date := coalesce(p_to, p_from);
  v_summary text;
begin
  if p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('MEAL_OFF', 'GUEST') then raise exception 'INVALID_KIND'; end if;
  if p_from is null then raise exception 'INVALID_DATE'; end if;
  if p_from < v_today then raise exception 'PAST_DATE'; end if;
  if p_kind = 'GUEST' then v_to := p_from; end if;
  if v_to < p_from or v_to - p_from > 30 then raise exception 'INVALID_RANGE'; end if;
  if not (coalesce(p_breakfast, false) or coalesce(p_lunch, false) or coalesce(p_dinner, false)) then raise exception 'NO_MEALS'; end if;

  select id, name into v_member from public.members
   where group_id = p_group and user_id = auth.uid() and status = 'ACTIVE'
   order by created_at limit 1;
  if v_member.id is null then raise exception 'NO_MEMBER_ROW'; end if;

  -- no duplicate pending request for exactly the same thing
  if exists (select 1 from public.meal_requests
              where group_id = p_group and member_id = v_member.id and status = 'PENDING' and kind = p_kind
                and date_from = p_from and date_to = v_to) then
    raise exception 'DUPLICATE_REQUEST';
  end if;

  insert into public.meal_requests (group_id, member_id, member_name, requested_by, kind, date_from, date_to,
                                    breakfast, lunch, dinner, guest_name, quantity, note)
  values (p_group, v_member.id, left(v_member.name, 80), auth.uid(), p_kind, p_from, v_to,
          coalesce(p_breakfast, false), coalesce(p_lunch, false), coalesce(p_dinner, false),
          nullif(left(btrim(coalesce(p_guest_name, '')), 120), ''),
          case when p_kind = 'GUEST' then greatest(1, least(coalesce(p_quantity, 1), 20)) else 1 end,
          nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;

  v_summary := case when p_kind = 'MEAL_OFF'
    then 'requested meal off · ' || public._req_dates(p_from, v_to) || ' · ' || public._req_meals(p_breakfast, p_lunch, p_dinner)
    else 'requested ' || case when coalesce(p_quantity, 1) > 1 then coalesce(p_quantity, 1)::text || ' guest meals' else 'a guest meal' end
         || coalesce(' (' || nullif(btrim(coalesce(p_guest_name, '')), '') || ')', '')
         || ' · ' || public._req_dates(p_from, p_from) || ' · ' || public._req_meals(p_breakfast, p_lunch, p_dinner) end;
  perform public._log_activity(p_group, 'request', 'requested', v_summary);
  return v_id;
end;
$$;

-- The person who asked can withdraw a request that is still pending.
create or replace function public.cancel_meal_request(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare r public.meal_requests;
begin
  select * into r from public.meal_requests where id = p_id for update;
  if r.id is null or r.group_id not in (select public.my_group_ids()) then raise exception 'NOT_FOUND'; end if;
  if r.requested_by is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'PENDING' then raise exception 'ALREADY_DECIDED'; end if;
  update public.meal_requests set status = 'CANCELLED', decided_at = now() where id = p_id;
  perform public._log_activity(r.group_id, 'request', 'cancelled',
    'cancelled their ' || case when r.kind = 'MEAL_OFF' then 'meal off' else 'guest meal' end
    || ' request · ' || public._req_dates(r.date_from, r.date_to));
end;
$$;

-- Admin / Moderator (anyone with meals.edit) approves or rejects.
-- Approve MEAL_OFF: the chosen meals are switched off for every day in the
--   range (other meals keep their current value, or the member's default).
-- Approve GUEST: a guest meal is added for that member.
create or replace function public.decide_meal_request(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  r public.meal_requests;
  v_def jsonb;
  v_d date;
  v_summary text;
begin
  select * into r from public.meal_requests where id = p_id for update;
  if r.id is null or r.group_id not in (select public.my_group_ids()) then raise exception 'NOT_FOUND'; end if;
  if not public.has_permission(r.group_id, 'meals.edit') then raise exception 'FORBIDDEN'; end if;
  if r.status <> 'PENDING' then raise exception 'ALREADY_DECIDED'; end if;

  if p_approve then
    select default_meals into v_def from public.members where group_id = r.group_id and id = r.member_id;
    if not found then raise exception 'MEMBER_GONE'; end if;
    if r.kind = 'MEAL_OFF' then
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
         then 'meal off request · ' || public._req_dates(r.date_from, r.date_to) || ' · ' || public._req_meals(r.breakfast, r.lunch, r.dinner)
         else 'guest meal request · ' || public._req_dates(r.date_from, r.date_from) || ' · ' || public._req_meals(r.breakfast, r.lunch, r.dinner)
              || case when r.quantity > 1 then ' ×' || r.quantity else '' end end
    || coalesce(' — "' || nullif(btrim(coalesce(p_note, '')), '') || '"', '');
  perform public._log_activity(r.group_id, 'request', case when p_approve then 'approved' else 'rejected' end, v_summary, r.requested_by);
end;
$$;

revoke all on function public.list_activity(uuid, integer) from public, anon;
revoke all on function public.create_meal_request(uuid, text, date, date, boolean, boolean, boolean, text, integer, text) from public, anon;
revoke all on function public.cancel_meal_request(uuid) from public, anon;
revoke all on function public.decide_meal_request(uuid, boolean, text) from public, anon;
grant execute on function public.list_activity(uuid, integer) to authenticated;
grant execute on function public.create_meal_request(uuid, text, date, date, boolean, boolean, boolean, text, integer, text) to authenticated;
grant execute on function public.cancel_meal_request(uuid) to authenticated;
grant execute on function public.decide_meal_request(uuid, boolean, text) to authenticated;
