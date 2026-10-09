-- =====================================================================
-- MealMate 0005 — Phone notifications (Android app)
--
-- 1. push_tokens: which phone belongs to which account + mess. The app
--    saves its token with save_push_token() and removes it on sign-out
--    with delete_push_token(). Nobody can read the table directly.
-- 2. activity_log.pushed_at: set by the "push" Edge Function when it has
--    sent a line to phones, so the same line is never sent twice.
--
-- The Edge Function (supabase/functions/push) is called by a Database
-- Webhook on INSERT into activity_log (set up in the dashboard). It decides
-- which lines go to phones (meal off, guest meals, money added, edits of
-- money / guest meals); everything else stays in the in-app bell only.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.push_tokens (
  token       text primary key check (char_length(token) between 10 and 4096),
  user_id     uuid not null references auth.users (id) on delete cascade,
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  platform    text not null default 'android' check (platform in ('android', 'web', 'ios')),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_group_user_idx on public.push_tokens (group_id, user_id);

alter table public.push_tokens enable row level security;
-- no policies: apps only use the two functions below; the Edge Function
-- reads it with the service role.
revoke all on public.push_tokens from anon, authenticated;

create or replace function public.save_push_token(p_group uuid, p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_group not in (select public.my_group_ids()) then raise exception 'FORBIDDEN'; end if;
  if p_token is null or char_length(p_token) not between 10 and 4096 then raise exception 'INVALID_TOKEN'; end if;
  insert into public.push_tokens (token, user_id, group_id, platform, updated_at)
  values (p_token, auth.uid(), p_group, coalesce(nullif(p_platform, ''), 'android'), now())
  on conflict (token) do update
    set user_id = excluded.user_id, group_id = excluded.group_id,
        platform = excluded.platform, updated_at = now();
  -- a person has at most 10 phones; drop the oldest beyond that
  delete from public.push_tokens
   where user_id = auth.uid()
     and token not in (select token from public.push_tokens where user_id = auth.uid() order by updated_at desc limit 10);
end;
$$;

create or replace function public.delete_push_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

revoke all on function public.save_push_token(uuid, text, text) from public, anon;
revoke all on function public.delete_push_token(text) from public, anon;
grant execute on function public.save_push_token(uuid, text, text) to authenticated;
grant execute on function public.delete_push_token(text) to authenticated;

-- sent-to-phones marker (only the service role writes it)
alter table public.activity_log add column if not exists pushed_at timestamptz;
