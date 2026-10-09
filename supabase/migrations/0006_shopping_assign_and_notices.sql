-- =====================================================================
-- MealMate 0006 — Shopping list assignment + Notices
--
-- 1. shopping_plans: one per mess. An Admin/Moderator (shopping.manage)
--    assigns the current shopping list to one or more members and sets a
--    close date. The assigned members get a notification. The day after
--    the close date the whole list is cleared (sweep_shopping, called by
--    the app when it opens the Shopping List / Dashboard).
-- 2. notices: Admins/Moderators post a notice (title + message) to the
--    whole mess; it can be edited or deleted. Posting and editing notify
--    everyone.
-- 3. activity_log.kind also allows 'notice'.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------- 3. activity kinds ----------
alter table public.activity_log drop constraint if exists activity_log_kind_check;
alter table public.activity_log add constraint activity_log_kind_check
  check (kind in ('meal','guest','expense','deposit','member','shopping','store','month','settlement','request','team','settings','notice','other'));

-- the time zone the mess lives in (dates like "close on Oct 12" are local days)
create or replace function public._mess_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

-- is the signed-in user an Admin or Moderator of this mess?
create or replace function public._is_manager(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                  where group_id = p_group and user_id = auth.uid() and status = 'ACTIVE' and role in ('ADMIN', 'MODERATOR'));
$$;

-- ---------- 1. shopping plan ----------
create table if not exists public.shopping_plans (
  group_id       uuid primary key references public.meal_groups (id) on delete cascade,
  member_ids     text[] not null default '{}',
  close_date     date not null,
  note           text check (note is null or char_length(note) <= 300),
  assigned_by    uuid references auth.users (id) on delete set null,
  assigned_name  text not null default '',
  updated_at     timestamptz not null default now()
);
alter table public.shopping_plans enable row level security;
drop policy if exists shopping_plans_select on public.shopping_plans;
create policy shopping_plans_select on public.shopping_plans for select to authenticated
  using (group_id in (select public.my_group_ids()));
revoke all on public.shopping_plans from anon, authenticated;
grant select on public.shopping_plans to authenticated;

create or replace function public.set_shopping_plan(p_group uuid, p_member_ids text[], p_close_date date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ids text[]; v_names text;
begin
  if p_group not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_close_date is null or p_close_date < public._mess_today() then raise exception 'PAST_DATE'; end if;
  if p_close_date > public._mess_today() + 60 then raise exception 'TOO_FAR'; end if;
  select array_agg(m.id order by m.name), string_agg(m.name, ', ' order by m.name)
    into v_ids, v_names
    from public.members m
   where m.group_id = p_group and m.status = 'ACTIVE' and m.id = any(coalesce(p_member_ids, '{}'));
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_MEMBERS'; end if;
  insert into public.shopping_plans (group_id, member_ids, close_date, note, assigned_by, assigned_name, updated_at)
  values (p_group, v_ids, p_close_date, nullif(left(btrim(coalesce(p_note, '')), 300), ''), auth.uid(), left(public._my_name(), 120), now())
  on conflict (group_id) do update
    set member_ids = excluded.member_ids, close_date = excluded.close_date, note = excluded.note,
        assigned_by = excluded.assigned_by, assigned_name = excluded.assigned_name, updated_at = now();
  perform public._log_activity(p_group, 'shopping', 'assigned',
    'assigned the shopping list to ' || v_names || ' · until ' || to_char(p_close_date, 'Mon FMDD')
    || coalesce(' — "' || nullif(left(btrim(coalesce(p_note, '')), 120), '') || '"', ''));
end;
$$;

create or replace function public.clear_shopping_plan(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_group not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  delete from public.shopping_plans where group_id = p_group;
end;
$$;

-- The day after the close date, the list is cleared. Any member's app may
-- call this; it only acts when the date has really passed. Returns true
-- when it cleared the list.
create or replace function public.sweep_shopping(p_group uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.shopping_plans;
begin
  if p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  select * into p from public.shopping_plans where group_id = p_group for update;
  if not found or p.close_date >= public._mess_today() then return false; end if;
  delete from public.shopping_items where group_id = p_group;
  delete from public.shopping_plans where group_id = p_group;
  perform public._log_activity(p_group, 'shopping', 'closed',
    'shopping list closed (' || to_char(p.close_date, 'Mon FMDD') || ') — the list was cleared');
  return true;
end;
$$;

revoke all on function public.set_shopping_plan(uuid, text[], date, text) from public, anon;
revoke all on function public.clear_shopping_plan(uuid) from public, anon;
revoke all on function public.sweep_shopping(uuid) from public, anon;
grant execute on function public.set_shopping_plan(uuid, text[], date, text) to authenticated;
grant execute on function public.clear_shopping_plan(uuid) to authenticated;
grant execute on function public.sweep_shopping(uuid) to authenticated;

-- ---------- 2. notices ----------
create table if not exists public.notices (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.meal_groups (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null default '' check (char_length(body) <= 2000),
  author_id    uuid references auth.users (id) on delete set null,
  author_name  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists notices_group_time_idx on public.notices (group_id, created_at desc);
alter table public.notices enable row level security;
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (group_id in (select public.my_group_ids()));
revoke all on public.notices from anon, authenticated;
grant select on public.notices to authenticated;

create or replace function public.create_notice(p_group uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  if not public._is_manager(p_group) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  insert into public.notices (group_id, title, body, author_id, author_name)
  values (p_group, left(v_title, 120), left(v_body, 2000), auth.uid(), left(public._my_name(), 120))
  returning id into v_id;
  perform public._log_activity(p_group, 'notice', 'posted', 'posted a notice: ' || left(v_title, 120)
    || case when v_body <> '' then ' — ' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 200) else '' end);
  return v_id;
end;
$$;

create or replace function public.update_notice(p_id uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare n public.notices; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  select * into n from public.notices where id = p_id;
  if not found or not public._is_manager(n.group_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  update public.notices set title = left(v_title, 120), body = left(v_body, 2000), updated_at = now() where id = p_id;
  perform public._log_activity(n.group_id, 'notice', 'updated', 'updated the notice: ' || left(v_title, 120)
    || case when v_body <> '' then ' — ' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 200) else '' end);
end;
$$;

create or replace function public.delete_notice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n public.notices;
begin
  select * into n from public.notices where id = p_id;
  if not found or not public._is_manager(n.group_id) then raise exception 'FORBIDDEN'; end if;
  delete from public.notices where id = p_id;
end;
$$;

revoke all on function public.create_notice(uuid, text, text) from public, anon;
revoke all on function public.update_notice(uuid, text, text) from public, anon;
revoke all on function public.delete_notice(uuid) from public, anon;
grant execute on function public.create_notice(uuid, text, text) to authenticated;
grant execute on function public.update_notice(uuid, text, text) to authenticated;
grant execute on function public.delete_notice(uuid) to authenticated;
