-- =====================================================================
-- MealMate 0008 — Several shopping lists
--
-- shopping_lists: each list has a name, a date (the list is cleared the day
-- after it), the members it is assigned to and an optional note. Every
-- shopping item belongs to a list (shopping_items.list_id). "Shopping Done"
-- deletes one list and its items. Replaces the single shopping_plans row
-- (existing items and assignment are moved into "List 1").
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.shopping_lists (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.meal_groups (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  list_date      date not null,
  member_ids     text[] not null default '{}',
  note           text check (note is null or char_length(note) <= 300),
  assigned_name  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists shopping_lists_group_idx on public.shopping_lists (group_id, created_at);
alter table public.shopping_lists enable row level security;
drop policy if exists shopping_lists_select on public.shopping_lists;
create policy shopping_lists_select on public.shopping_lists for select to authenticated
  using (group_id in (select public.my_group_ids()));
revoke all on public.shopping_lists from anon, authenticated;
grant select on public.shopping_lists to authenticated;

alter table public.shopping_items add column if not exists list_id uuid references public.shopping_lists (id) on delete cascade;
create index if not exists shopping_items_list_idx on public.shopping_items (list_id);

-- move what exists today into "List 1" (only for messes that have no list yet)
do $$
declare g record; v_id uuid; p public.shopping_plans;
begin
  for g in
    select distinct group_id from (
      select group_id from public.shopping_items where list_id is null
      union select group_id from public.shopping_plans
    ) x
    where not exists (select 1 from public.shopping_lists l where l.group_id = x.group_id)
  loop
    select * into p from public.shopping_plans where group_id = g.group_id;
    insert into public.shopping_lists (group_id, name, list_date, member_ids, note, assigned_name)
    values (g.group_id, 'List 1', coalesce(p.close_date, public._mess_today()), coalesce(p.member_ids, '{}'), p.note, coalesce(p.assigned_name, ''))
    returning id into v_id;
    update public.shopping_items set list_id = v_id where group_id = g.group_id and list_id is null;
  end loop;
end $$;

create or replace function public.create_shopping_list(p_group uuid, p_name text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := left(btrim(coalesce(p_name, '')), 60);
begin
  if p_group not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_date is null or p_date < public._mess_today() then raise exception 'PAST_DATE'; end if;
  if p_date > public._mess_today() + 60 then raise exception 'TOO_FAR'; end if;
  if v_name = '' then
    v_name := 'List ' || ((select count(*) from public.shopping_lists where group_id = p_group) + 1);
  end if;
  insert into public.shopping_lists (group_id, name, list_date) values (p_group, v_name, p_date) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.assign_shopping_list(p_list uuid, p_member_ids text[], p_date date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.shopping_lists; v_ids text[]; v_names text;
begin
  select * into l from public.shopping_lists where id = p_list;
  if not found or l.group_id not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_date is null or p_date < public._mess_today() then raise exception 'PAST_DATE'; end if;
  if p_date > public._mess_today() + 60 then raise exception 'TOO_FAR'; end if;
  select array_agg(m.id order by m.name), string_agg(m.name, ', ' order by m.name)
    into v_ids, v_names
    from public.members m
   where m.group_id = l.group_id and m.status = 'ACTIVE' and m.id = any(coalesce(p_member_ids, '{}'));
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_MEMBERS'; end if;
  update public.shopping_lists
     set member_ids = v_ids, list_date = p_date, note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
         assigned_name = left(public._my_name(), 120), updated_at = now()
   where id = p_list;
  perform public._log_activity(l.group_id, 'shopping', 'assigned',
    'assigned ' || l.name || ' to ' || v_names || ' · until ' || to_char(p_date, 'Mon FMDD')
    || coalesce(' — "' || nullif(left(btrim(coalesce(p_note, '')), 120), '') || '"', ''));
end;
$$;

create or replace function public.clear_list_assignment(p_list uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.shopping_lists;
begin
  select * into l from public.shopping_lists where id = p_list;
  if not found or l.group_id not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  update public.shopping_lists set member_ids = '{}', updated_at = now() where id = p_list;
end;
$$;

-- "Shopping Done": the list and all its items disappear
create or replace function public.finish_shopping_list(p_list uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.shopping_lists;
begin
  select * into l from public.shopping_lists where id = p_list;
  if not found or l.group_id not in (select public.my_groups_with('shopping.manage')) then raise exception 'FORBIDDEN'; end if;
  delete from public.shopping_lists where id = p_list;
  perform public._log_activity(l.group_id, 'shopping', 'closed', 'finished the bazar — ' || l.name || ' was cleared');
end;
$$;

-- lists whose date has passed are cleared (any member's app may call this)
create or replace function public.sweep_shopping(p_group uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  delete from public.shopping_lists where group_id = p_group and list_date < public._mess_today();
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._log_activity(p_group, 'shopping', 'closed', 'shopping list date passed — ' || v_n || ' list(s) cleared');
  end if;
  return v_n > 0;
end;
$$;

revoke all on function public.create_shopping_list(uuid, text, date) from public, anon;
revoke all on function public.assign_shopping_list(uuid, text[], date, text) from public, anon;
revoke all on function public.clear_list_assignment(uuid) from public, anon;
revoke all on function public.finish_shopping_list(uuid) from public, anon;
revoke all on function public.sweep_shopping(uuid) from public, anon;
grant execute on function public.create_shopping_list(uuid, text, date) to authenticated;
grant execute on function public.assign_shopping_list(uuid, text[], date, text) to authenticated;
grant execute on function public.clear_list_assignment(uuid) to authenticated;
grant execute on function public.finish_shopping_list(uuid) to authenticated;
grant execute on function public.sweep_shopping(uuid) to authenticated;
