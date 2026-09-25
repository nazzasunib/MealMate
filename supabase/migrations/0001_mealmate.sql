-- =====================================================================
-- MealMate — multi-user schema, permissions, RLS and RPCs
-- Run this once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Core identity tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 80),
  email       text not null default '',
  avatar_url  text check (avatar_url is null or char_length(avatar_url) <= 400000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.meal_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Invite codes live in their own table so only people allowed to manage
-- invites (Admins) can read them — regular members never see the code.
create table if not exists public.group_invites (
  group_id    uuid primary key references public.meal_groups (id) on delete cascade,
  code        text not null unique check (code ~ '^MM-[A-Z0-9]{6}$'),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
-- When ON, anyone joining with the code/link becomes an ACTIVE member right
-- away; when OFF (default), the join waits for Admin/Moderator approval.
alter table public.group_invites add column if not exists auto_approve boolean not null default false;

create table if not exists public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'MEMBER' check (role in ('ADMIN', 'MODERATOR', 'MEMBER')),
  joined_at   timestamptz not null default now(),
  unique (group_id, user_id),
  -- v1: one MealMate per account
  unique (user_id)
);
create index if not exists group_members_group_idx on public.group_members (group_id, role);
-- A join-by-invite-code account starts PENDING and only counts as a real
-- member (with roster/meal access) once an Admin/Moderator approves it.
alter table public.group_members add column if not exists status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PENDING'));

create table if not exists public.role_permissions (
  role        text not null check (role in ('ADMIN', 'MODERATOR', 'MEMBER')),
  permission  text not null,
  primary key (role, permission)
);

-- Permission catalogue. Add rows here to expand a role later — no code change
-- is needed on the database side; the app reads this table on login.
insert into public.role_permissions (role, permission) values
  ('ADMIN','reports.view'),('ADMIN','members.view'),('ADMIN','members.manage'),('ADMIN','members.remove'),
  ('ADMIN','invites.manage'),('ADMIN','roles.manage'),('ADMIN','meals.edit'),('ADMIN','expenses.create'),
  ('ADMIN','expenses.edit'),('ADMIN','expenses.delete'),('ADMIN','deposits.manage'),('ADMIN','shopping.manage'),
  ('ADMIN','stock.edit'),('ADMIN','month.close'),('ADMIN','settings.manage'),
  ('MODERATOR','reports.view'),('MODERATOR','members.view'),('MODERATOR','members.manage'),('MODERATOR','meals.edit'),
  ('MODERATOR','expenses.create'),('MODERATOR','shopping.manage'),('MODERATOR','stock.edit'),
  ('MEMBER','reports.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. MealMate data tables (every row belongs to exactly one group)
--    Primary keys lead with group_id so each group's data is physically
--    clustered and every lookup is an index range scan.
-- ---------------------------------------------------------------------
create table if not exists public.members (
  group_id      uuid not null references public.meal_groups (id) on delete cascade,
  id            text not null check (char_length(id) <= 64),
  user_id       uuid references auth.users (id) on delete set null,
  name          text not null check (char_length(name) between 1 and 80),
  avatar_color  text not null default '#0B1F4B' check (char_length(avatar_color) <= 32),
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  joined_at     date not null default current_date,
  phone         text check (phone is null or char_length(phone) <= 40),
  email         text check (email is null or char_length(email) <= 254),
  picture_url   text check (picture_url is null or char_length(picture_url) <= 400000),
  default_meals jsonb not null default '{"breakfast":false,"lunch":true,"dinner":true}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (group_id, id)
);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.meals (
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  member_id   text not null check (char_length(member_id) <= 64),
  date        date not null,
  id          text,
  breakfast   boolean not null default false,
  lunch       boolean not null default false,
  dinner      boolean not null default false,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (group_id, member_id, date)
);
create index if not exists meals_group_date_idx on public.meals (group_id, date);

create table if not exists public.deposits (
  group_id               uuid not null references public.meal_groups (id) on delete cascade,
  id                     text not null check (char_length(id) <= 64),
  member_id              text not null check (char_length(member_id) <= 64),
  date                   date not null,
  amount                 numeric(14, 2) not null check (amount >= 0),
  note                   text check (note is null or char_length(note) <= 500),
  carried_from_month_key text check (carried_from_month_key is null or carried_from_month_key ~ '^\d{4}-\d{2}$'),
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (group_id, id)
);
create index if not exists deposits_group_date_idx on public.deposits (group_id, date);

create table if not exists public.expenses (
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  id          text not null check (char_length(id) <= 64),
  seq         bigint generated always as identity,
  date        date not null,
  amount      numeric(14, 2) not null check (amount >= 0),
  note        text check (note is null or char_length(note) <= 500),
  buyer_ids   text[] not null default '{}' check (cardinality(buyer_ids) <= 100),
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 60000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (group_id, id)
);
create index if not exists expenses_group_date_idx on public.expenses (group_id, date);

create table if not exists public.shopping_items (
  group_id    uuid not null references public.meal_groups (id) on delete cascade,
  id          text not null check (char_length(id) <= 64),
  category    text not null check (char_length(category) <= 80),
  item        text not null check (char_length(item) <= 120),
  quantity    text not null default '' check (char_length(quantity) <= 40),
  checked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (group_id, id)
);

create table if not exists public.store_carry_forward (
  group_id        uuid not null references public.meal_groups (id) on delete cascade,
  month_key       text not null check (month_key ~ '^\d{4}-\d{2}$'),
  from_month_key  text not null check (from_month_key = 'manual' or from_month_key ~ '^\d{4}-\d{2}$'),
  item            text not null check (char_length(item) <= 120),
  unit            text not null default '' check (char_length(unit) <= 20),
  quantity        numeric not null,
  updated_at      timestamptz not null default now(),
  primary key (group_id, month_key, from_month_key, item, unit)
);

create table if not exists public.store_closed_months (
  group_id   uuid not null references public.meal_groups (id) on delete cascade,
  month_key  text not null check (month_key ~ '^\d{4}-\d{2}$'),
  closed_at  timestamptz not null default now(),
  rows       jsonb not null default '[]'::jsonb,
  totals     jsonb not null default '{}'::jsonb,
  primary key (group_id, month_key)
);

create table if not exists public.money_closed_months (
  group_id   uuid not null references public.meal_groups (id) on delete cascade,
  month_key  text not null check (month_key ~ '^\d{4}-\d{2}$'),
  closed_at  timestamptz not null default now(),
  decisions  jsonb not null default '[]'::jsonb,
  primary key (group_id, month_key)
);

create table if not exists public.settlements (
  group_id          uuid not null references public.meal_groups (id) on delete cascade,
  month_key         text not null check (month_key ~ '^\d{4}-\d{2}$'),
  id                text,
  finalized_at      timestamptz not null default now(),
  total_bazar_cost  numeric(14, 2) not null default 0,
  total_paid        numeric(14, 2) not null default 0,
  total_meals       numeric not null default 0,
  meal_rate         numeric not null default 0,
  members           jsonb not null default '[]'::jsonb,
  transfers         jsonb not null default '[]'::jsonb,
  primary key (group_id, month_key)
);

-- ---------------------------------------------------------------------
-- 3. Helper functions used by RLS (SECURITY DEFINER so policies do not
--    recurse into group_members' own RLS; STABLE so Postgres caches them
--    per statement).
-- ---------------------------------------------------------------------
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and status = 'ACTIVE'
  );
$$;

create or replace function public.has_permission(p_group uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_members gm
    join public.role_permissions rp on rp.role = gm.role
    where gm.group_id = p_group and gm.user_id = auth.uid() and gm.status = 'ACTIVE' and rp.permission = p_permission
  );
$$;

-- Set-returning helpers: used as  group_id IN (SELECT my_group_ids())  so
-- Postgres evaluates them ONCE per query (InitPlan) instead of once per row.
-- This keeps reads fast even when a group has years of data. A PENDING
-- (not-yet-approved) account resolves to zero rows here, so it has no
-- access to any group data until an Admin/Moderator approves it.
create or replace function public.my_group_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select group_id from public.group_members where user_id = auth.uid() and status = 'ACTIVE';
$$;

create or replace function public.my_groups_with(p_permission text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select gm.group_id
  from public.group_members gm
  join public.role_permissions rp on rp.role = gm.role
  where gm.user_id = auth.uid() and gm.status = 'ACTIVE' and rp.permission = p_permission;
$$;

create or replace function public.shares_group_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user and a.status = 'ACTIVE' and b.status = 'ACTIVE'
  );
$$;

-- Crypto-random invite code: MM- + 6 chars (no 0/O/1/I to avoid confusion).
create or replace function public.generate_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea;
  result text;
  i int;
begin
  loop
    raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    result := 'MM-';
    for i in 0..5 loop
      result := result || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.group_invites where code = result);
  end loop;
  return result;
end;
$$;

create or replace function public.normalize_invite_code(p_code text)
returns text language sql immutable as $$
  select case
    when p_code is null then null
    when upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) like 'MM%'
      and char_length(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) = 8
      then 'MM-' || substr(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 3)
    else 'MM-' || upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
  end;
$$;

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','members','meals','deposits','expenses','shopping_items','store_carry_forward','group_invites'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Profile row is created automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 80),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync if the user changes their auth email.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.meal_groups         enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_members       enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.members             enable row level security;
alter table public.meals               enable row level security;
alter table public.deposits            enable row level security;
alter table public.expenses            enable row level security;
alter table public.shopping_items      enable row level security;
alter table public.store_carry_forward enable row level security;
alter table public.store_closed_months enable row level security;
alter table public.money_closed_months enable row level security;
alter table public.settlements         enable row level security;

-- Drop old versions so re-running the script never leaves stale policies.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in (
      'profiles','meal_groups','group_invites','group_members','role_permissions','members','meals',
      'deposits','expenses','shopping_items','store_carry_forward','store_closed_months',
      'money_closed_months','settlements')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: you see yourself + people in your group; you edit only yourself.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- meal_groups / group_members / invites: read-only through RLS.
-- Every write goes through the SECURITY DEFINER RPCs below, which is what
-- makes it impossible to self-promote or join a group without a valid code.
create policy meal_groups_select on public.meal_groups for select to authenticated
  using (id in (select public.my_group_ids()));
create policy group_members_select on public.group_members for select to authenticated
  using (group_id in (select public.my_group_ids()) or user_id = auth.uid());
create policy group_invites_select on public.group_invites for select to authenticated
  using (group_id in (select public.my_groups_with('invites.manage')));
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (true);

-- members (the mess roster)
create policy members_select on public.members for select to authenticated
  using (group_id in (select public.my_group_ids()));
-- No members_insert policy: roster rows are created only by the
-- SECURITY DEFINER approve_join_request()/create_meal_group() functions
-- (which bypass RLS), never by a direct client insert.
create policy members_update on public.members for update to authenticated
  using (group_id in (select public.my_groups_with('members.manage')))
  with check (group_id in (select public.my_groups_with('members.manage')));
create policy members_delete on public.members for delete to authenticated
  using (group_id in (select public.my_groups_with('members.remove')));

-- meals
create policy meals_select on public.meals for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy meals_insert on public.meals for insert to authenticated
  with check (group_id in (select public.my_groups_with('meals.edit')));
create policy meals_update on public.meals for update to authenticated
  using (group_id in (select public.my_groups_with('meals.edit')))
  with check (group_id in (select public.my_groups_with('meals.edit')));
create policy meals_delete on public.meals for delete to authenticated
  using (group_id in (select public.my_groups_with('meals.edit')));

-- deposits
create policy deposits_select on public.deposits for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy deposits_insert on public.deposits for insert to authenticated
  with check (group_id in (select public.my_groups_with('deposits.manage')));
create policy deposits_update on public.deposits for update to authenticated
  using (group_id in (select public.my_groups_with('deposits.manage')))
  with check (group_id in (select public.my_groups_with('deposits.manage')));
create policy deposits_delete on public.deposits for delete to authenticated
  using (group_id in (select public.my_groups_with('deposits.manage')));

-- expenses: moderators may add, only admins may edit / delete history
create policy expenses_select on public.expenses for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (group_id in (select public.my_groups_with('expenses.create')));
create policy expenses_update on public.expenses for update to authenticated
  using (group_id in (select public.my_groups_with('expenses.edit')))
  with check (group_id in (select public.my_groups_with('expenses.edit')));
create policy expenses_delete on public.expenses for delete to authenticated
  using (group_id in (select public.my_groups_with('expenses.delete')));

-- shopping list
create policy shopping_select on public.shopping_items for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy shopping_insert on public.shopping_items for insert to authenticated
  with check (group_id in (select public.my_groups_with('shopping.manage')));
create policy shopping_update on public.shopping_items for update to authenticated
  using (group_id in (select public.my_groups_with('shopping.manage')))
  with check (group_id in (select public.my_groups_with('shopping.manage')));
create policy shopping_delete on public.shopping_items for delete to authenticated
  using (group_id in (select public.my_groups_with('shopping.manage')));

-- store carry-forward: manual stock corrections are operational (moderators),
-- month-close carry-forward rows are critical (admins only).
create policy scf_select on public.store_carry_forward for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy scf_insert on public.store_carry_forward for insert to authenticated
  with check (public.has_permission(group_id, case when from_month_key = 'manual' then 'stock.edit' else 'month.close' end));
create policy scf_update on public.store_carry_forward for update to authenticated
  using (public.has_permission(group_id, case when from_month_key = 'manual' then 'stock.edit' else 'month.close' end))
  with check (public.has_permission(group_id, case when from_month_key = 'manual' then 'stock.edit' else 'month.close' end));
create policy scf_delete on public.store_carry_forward for delete to authenticated
  using (public.has_permission(group_id, case when from_month_key = 'manual' then 'stock.edit' else 'month.close' end));

-- monthly closing snapshots: admins only
create policy scm_select on public.store_closed_months for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy scm_write on public.store_closed_months for all to authenticated
  using (group_id in (select public.my_groups_with('month.close')))
  with check (group_id in (select public.my_groups_with('month.close')));
create policy mcm_select on public.money_closed_months for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy mcm_write on public.money_closed_months for all to authenticated
  using (group_id in (select public.my_groups_with('month.close')))
  with check (group_id in (select public.my_groups_with('month.close')));
create policy settlements_select on public.settlements for select to authenticated
  using (group_id in (select public.my_group_ids()));
create policy settlements_write on public.settlements for all to authenticated
  using (group_id in (select public.my_groups_with('month.close')))
  with check (group_id in (select public.my_groups_with('month.close')));

-- Column-level hardening on profiles: users may only edit name/avatar.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- Anonymous visitors get nothing from tables at all.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- 5. RPCs (the only way to create / join / administer a group)
-- ---------------------------------------------------------------------
create or replace function public._roster_id()
returns text language sql volatile as $$
  select 'mem_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
$$;

-- Everything the app needs about "me" in one round trip.
create or replace function public.get_my_membership()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v json;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select json_build_object(
    'group_id', g.id,
    'group_name', g.name,
    'role', gm.role,
    'status', gm.status,
    'joined_at', gm.joined_at,
    'member_id', (select m.id from public.members m where m.group_id = g.id and m.user_id = v_uid limit 1),
    'permissions', case when gm.status = 'ACTIVE'
      then coalesce((select json_agg(rp.permission order by rp.permission) from public.role_permissions rp where rp.role = gm.role), '[]'::json)
      else '[]'::json end
  ) into v
  from public.group_members gm
  join public.meal_groups g on g.id = gm.group_id
  where gm.user_id = v_uid;
  return v; -- null when the user has not created/joined a MealMate yet
end;
$$;

create or replace function public.create_meal_group(p_group_name text, p_full_name text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text := btrim(coalesce(p_group_name, ''));
  v_full text;
  v_group uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'INVALID_GROUP_NAME'; end if;
  if exists (select 1 from public.group_members where user_id = v_uid) then raise exception 'ALREADY_IN_GROUP'; end if;

  select email into v_email from auth.users where id = v_uid;
  insert into public.profiles (id, full_name, email)
    values (v_uid, left(coalesce(nullif(btrim(p_full_name), ''), split_part(coalesce(v_email, ''), '@', 1)), 80), coalesce(v_email, ''))
    on conflict (id) do update set full_name = case when nullif(btrim(p_full_name), '') is not null then left(btrim(p_full_name), 80) else public.profiles.full_name end;
  select full_name into v_full from public.profiles where id = v_uid;

  insert into public.meal_groups (name, created_by) values (v_name, v_uid) returning id into v_group;
  v_code := public.generate_invite_code();
  insert into public.group_invites (group_id, code, enabled) values (v_group, v_code, true);
  insert into public.group_members (group_id, user_id, role) values (v_group, v_uid, 'ADMIN');
  insert into public.members (group_id, id, user_id, name, email, avatar_color)
    values (v_group, public._roster_id(), v_uid, coalesce(nullif(v_full, ''), 'Admin'), v_email, '#0B1F4B');

  return json_build_object('group_id', v_group, 'group_name', v_name, 'invite_code', v_code);
exception
  when unique_violation then
    raise exception 'ALREADY_IN_GROUP';
end;
$$;


-- Brute-force protection for invite codes: too many wrong codes from one
-- account (or one IP for the public preview) in an hour are refused.
create table if not exists public.invite_attempts (
  id        bigint generated always as identity primary key,
  actor     text not null,
  at        timestamptz not null default now()
);
create index if not exists invite_attempts_actor_idx on public.invite_attempts (actor, at desc);
alter table public.invite_attempts enable row level security;  -- no policies: invisible to clients

create or replace function public._invite_actor()
returns text language sql stable as $$
  select coalesce(
    'u:' || auth.uid()::text,
    'ip:' || nullif(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    'anon'
  );
$$;

create or replace function public._invite_guard()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_actor text := public._invite_actor();
begin
  if (select count(*) from public.invite_attempts where actor = v_actor and at > now() - interval '1 hour') >= 20 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
end;
$$;

create or replace function public._invite_fail()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.invite_attempts (actor) values (public._invite_actor());
  -- keep the table small
  delete from public.invite_attempts where at < now() - interval '1 day' and random() < 0.01;
end;
$$;

-- Public (anon) preview so an invite link can show the MealMate's name
-- before the visitor signs in. Reveals nothing but the group name.
create or replace function public.get_invite_preview(p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v json;
begin
  perform public._invite_guard();
  select json_build_object('group_name', g.name, 'enabled', i.enabled, 'code', i.code)
    into v
  from public.group_invites i
  join public.meal_groups g on g.id = i.group_id
  where i.code = public.normalize_invite_code(p_code);
  if v is null then perform public._invite_fail(); end if;
  return v; -- null = invalid code
end;
$$;

create or replace function public.join_meal_group(p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full text;
  v_inv record;
  v_existing uuid;
  v_member_id text;
  v_colors text[] := array['#0B1F4B','#1A3570','#16A34A','#B45309','#7C3AED','#DC2626'];
  v_count int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  perform public._invite_guard();
  select i.group_id, i.enabled, i.auto_approve, g.name into v_inv
  from public.group_invites i join public.meal_groups g on g.id = i.group_id
  where i.code = public.normalize_invite_code(p_code);
  if not found then
    perform public._invite_fail();
    return json_build_object('error', 'INVALID_INVITE');  -- returned (not raised) so the failed attempt is kept
  end if;
  if not v_inv.enabled then raise exception 'INVITE_DISABLED'; end if;

  select group_id into v_existing from public.group_members where user_id = v_uid;
  if v_existing is not null then
    if v_existing = v_inv.group_id then raise exception 'ALREADY_MEMBER'; end if;
    raise exception 'ALREADY_IN_GROUP';
  end if;

  select email into v_email from auth.users where id = v_uid;
  insert into public.profiles (id, full_name, email)
    values (v_uid, split_part(coalesce(v_email, ''), '@', 1), coalesce(v_email, ''))
    on conflict (id) do nothing;

  -- Default role is always MEMBER, and every new join starts PENDING: it
  -- only becomes a real member (with roster + meal access) once an
  -- Admin/Moderator approves it via approve_join_request() -- unless the
  -- group has auto-approve ON, in which case it is activated right here.
  -- Either way the roster row is stamped with the day they were let in.
  insert into public.group_members (group_id, user_id, role, status) values (v_inv.group_id, v_uid, 'MEMBER', 'PENDING');
  if v_inv.auto_approve then
    perform public._activate_member(v_inv.group_id, v_uid);
    return json_build_object('group_id', v_inv.group_id, 'group_name', v_inv.name, 'status', 'ACTIVE');
  end if;

  return json_build_object('group_id', v_inv.group_id, 'group_name', v_inv.name, 'status', 'PENDING');
exception
  when unique_violation then
    raise exception 'ALREADY_IN_GROUP';
end;
$$;

-- ---------------------------------------------------------------------
-- Join-request approval (Admin/Moderator only). This is the ONLY way a
-- roster (meal-tracking) row is ever created for someone who joined via
-- invite code -- there is no manual "add member" path anymore.
-- ---------------------------------------------------------------------
create or replace function public.list_join_requests(p_group uuid)
returns table (user_id uuid, full_name text, email text, requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select gm.user_id, p.full_name, p.email, gm.joined_at
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  where gm.group_id = p_group and gm.status = 'PENDING'
    and public.has_permission(p_group, 'members.manage')
  order by gm.joined_at;
$$;

-- Internal: flips a PENDING account to ACTIVE and links/creates its roster
-- row. Not granted to clients -- only called from the RPCs below.
create or replace function public._activate_member(p_group uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_email text;
  v_full text;
  v_member_id text;
  v_count int;
  v_colors text[] := array['#0B1F4B','#1A3570','#16A34A','#B45309','#7C3AED','#DC2626'];
begin
  update public.group_members set status = 'ACTIVE' where group_id = p_group and user_id = p_user;

  select email, full_name into v_email, v_full from public.profiles where id = p_user;

  -- Link to the mess roster: re-activate a previous row, adopt a row the
  -- admin already created with the same email, or create a new one --
  -- and always stamp joined_at as TODAY, so meals never count from before
  -- the day this account was actually let in.
  select id into v_member_id from public.members where group_id = p_group and user_id = p_user limit 1;
  if v_member_id is null and v_email is not null then
    select id into v_member_id from public.members
      where group_id = p_group and user_id is null and lower(email) = lower(v_email)
      order by created_at limit 1;
  end if;
  if v_member_id is not null then
    update public.members set user_id = p_user, status = 'ACTIVE', joined_at = current_date where group_id = p_group and id = v_member_id;
  else
    select count(*) into v_count from public.members where group_id = p_group;
    insert into public.members (group_id, id, user_id, name, email, avatar_color, joined_at)
      values (p_group, public._roster_id(), p_user, coalesce(nullif(v_full, ''), 'Member'), v_email,
              v_colors[(v_count % array_length(v_colors, 1)) + 1], current_date);
  end if;
end;
$$;

create or replace function public.approve_join_request(p_group uuid, p_user uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'members.manage') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and status = 'PENDING') then
    raise exception 'NOT_PENDING';
  end if;
  perform public._activate_member(p_group, p_user);
  return json_build_object('ok', true);
end;
$$;

create or replace function public.reject_join_request(p_group uuid, p_user uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'members.manage') then raise exception 'FORBIDDEN'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user and status = 'PENDING';
  if not found then raise exception 'NOT_PENDING'; end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.regenerate_invite_code(p_group uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_code text;
begin
  if not public.has_permission(p_group, 'invites.manage') then raise exception 'FORBIDDEN'; end if;
  v_code := public.generate_invite_code();
  update public.group_invites set code = v_code, enabled = true where group_id = p_group;
  if not found then
    insert into public.group_invites (group_id, code, enabled) values (p_group, v_code, true);
  end if;
  return v_code;
end;
$$;

create or replace function public.set_invite_enabled(p_group uuid, p_enabled boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'invites.manage') then raise exception 'FORBIDDEN'; end if;
  update public.group_invites set enabled = coalesce(p_enabled, false) where group_id = p_group;
end;
$$;

create or replace function public.set_invite_auto_approve(p_group uuid, p_enabled boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'invites.manage') then raise exception 'FORBIDDEN'; end if;
  update public.group_invites set auto_approve = coalesce(p_enabled, false) where group_id = p_group;
end;
$$;

create or replace function public.list_group_accounts(p_group uuid)
returns table (user_id uuid, full_name text, email text, avatar_url text, role text, joined_at timestamptz, roster_status text, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'members.view') then raise exception 'FORBIDDEN'; end if;
  return query
    select gm.user_id, p.full_name, p.email, p.avatar_url, gm.role, gm.joined_at,
           coalesce((select m.status from public.members m where m.group_id = gm.group_id and m.user_id = gm.user_id limit 1), 'ACTIVE'),
           gm.user_id = auth.uid()
    from public.group_members gm
    left join public.profiles p on p.id = gm.user_id
    where gm.group_id = p_group and gm.status = 'ACTIVE'
    order by case gm.role when 'ADMIN' then 0 when 'MODERATOR' then 1 else 2 end, gm.joined_at;
end;
$$;

create or replace function public.change_member_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_current text;
  v_admins int;
begin
  if not public.has_permission(p_group, 'roles.manage') then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('ADMIN', 'MODERATOR', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  -- serialize role changes per group so two admins can't demote each other at once
  perform 1 from public.meal_groups where id = p_group for update;
  select role into v_current from public.group_members where group_id = p_group and user_id = p_user;
  if v_current is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_current = p_role then return; end if;
  if v_current = 'ADMIN' then
    select count(*) into v_admins from public.group_members where group_id = p_group and role = 'ADMIN';
    if v_admins <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
end;
$$;

create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_current text;
  v_admins int;
begin
  if not public.has_permission(p_group, 'members.remove') then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.meal_groups where id = p_group for update;
  select role into v_current from public.group_members where group_id = p_group and user_id = p_user;
  if v_current is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_current = 'ADMIN' then
    select count(*) into v_admins from public.group_members where group_id = p_group and role = 'ADMIN';
    if v_admins <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  -- Keep their meal / money history, just take them off the active roster.
  update public.members set status = 'INACTIVE' where group_id = p_group and user_id = p_user;
end;
$$;

create or replace function public.update_group_name(p_group uuid, p_name text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'settings.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 60 then raise exception 'INVALID_GROUP_NAME'; end if;
  update public.meal_groups set name = btrim(p_name) where id = p_group;
end;
$$;

-- Lock down function execution.
revoke execute on all functions in schema public from public, anon;
-- Internal helper: callable only from the SECURITY DEFINER RPCs, never by a client.
revoke execute on function public._activate_member(uuid, uuid) from authenticated;
grant execute on function public.get_invite_preview(text) to anon, authenticated;
grant execute on function
  public.my_group_ids(),
  public.my_groups_with(text),
  public.is_group_member(uuid),
  public.has_permission(uuid, text),
  public.shares_group_with(uuid),
  public.get_my_membership(),
  public.create_meal_group(text, text),
  public.join_meal_group(text),
  public.regenerate_invite_code(uuid),
  public.set_invite_enabled(uuid, boolean),
  public.set_invite_auto_approve(uuid, boolean),
  public.list_group_accounts(uuid),
  public.change_member_role(uuid, uuid, text),
  public.remove_group_member(uuid, uuid),
  public.update_group_name(uuid, text),
  public.list_join_requests(uuid),
  public.approve_join_request(uuid, uuid),
  public.reject_join_request(uuid, uuid)
to authenticated;
