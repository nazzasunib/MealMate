-- =====================================================================
-- MealMate 0007 — Notice date range + End Notice, and "Bazar done"
--
-- 1. notices.start_date / end_date (required for new notices) and
--    notices.ended_at (set by "End notice").
--
-- Safe to run more than once.
-- =====================================================================

alter table public.notices add column if not exists start_date date;
alter table public.notices add column if not exists end_date date;
alter table public.notices add column if not exists ended_at timestamptz;

drop function if exists public.create_notice(uuid, text, text);
drop function if exists public.update_notice(uuid, text, text);

create or replace function public.create_notice(p_group uuid, p_title text, p_body text, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  if not public._is_manager(p_group) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'BAD_DATES'; end if;
  if p_end < public._mess_today() then raise exception 'PAST_DATE'; end if;
  insert into public.notices (group_id, title, body, author_id, author_name, start_date, end_date)
  values (p_group, left(v_title, 120), left(v_body, 2000), auth.uid(), left(public._my_name(), 120), p_start, p_end)
  returning id into v_id;
  perform public._log_activity(p_group, 'notice', 'posted', 'posted a notice: ' || left(v_title, 120)
    || case when v_body <> '' then ' — ' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 200) else '' end);
  return v_id;
end;
$$;

create or replace function public.update_notice(p_id uuid, p_title text, p_body text, p_start date, p_end date)
returns void language plpgsql security definer set search_path = public as $$
declare n public.notices; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  select * into n from public.notices where id = p_id;
  if not found or not public._is_manager(n.group_id) then raise exception 'FORBIDDEN'; end if;
  if char_length(v_title) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'BAD_DATES'; end if;
  if p_end < public._mess_today() then raise exception 'PAST_DATE'; end if;
  update public.notices
     set title = left(v_title, 120), body = left(v_body, 2000), start_date = p_start, end_date = p_end,
         ended_at = null, updated_at = now()
   where id = p_id;
  perform public._log_activity(n.group_id, 'notice', 'updated', 'updated the notice: ' || left(v_title, 120)
    || case when v_body <> '' then ' — ' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 200) else '' end);
end;
$$;

create or replace function public.end_notice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n public.notices;
begin
  select * into n from public.notices where id = p_id;
  if not found or not public._is_manager(n.group_id) then raise exception 'FORBIDDEN'; end if;
  update public.notices set ended_at = now() where id = p_id and ended_at is null;
  perform public._log_activity(n.group_id, 'notice', 'ended', 'ended the notice: ' || left(n.title, 120));
end;
$$;

revoke all on function public.create_notice(uuid, text, text, date, date) from public, anon;
revoke all on function public.update_notice(uuid, text, text, date, date) from public, anon;
revoke all on function public.end_notice(uuid) from public, anon;
grant execute on function public.create_notice(uuid, text, text, date, date) to authenticated;
grant execute on function public.update_notice(uuid, text, text, date, date) to authenticated;
grant execute on function public.end_notice(uuid) to authenticated;
