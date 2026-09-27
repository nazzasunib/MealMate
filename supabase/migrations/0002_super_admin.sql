-- =====================================================================
-- MealMate — Super Admin (run AFTER 0001_mealmate.sql; safe to re-run)
--
-- Every mess has exactly ONE Super Admin (an Admin with is_super_admin).
--   * Nobody can change the Super Admin's role or remove them.
--   * Only the Super Admin can make someone an Admin, or change/remove an
--     existing Admin. Regular Admins manage Moderators and Members only.
--   * The Super Admin can hand the title to another member; they then stay
--     a regular Admin.
--   * Existing messes: the creator becomes Super Admin (if they have left,
--     the longest-standing Admin does). If a Super Admin's account is ever
--     deleted, the same rule picks a new one automatically.
-- All rules live here in the database, so they can't be bypassed from
-- the browser. (group_members has no UPDATE/DELETE policy for clients —
-- every change goes through these functions.)
-- =====================================================================

alter table public.group_members add column if not exists is_super_admin boolean not null default false;
create unique index if not exists group_members_one_super_admin on public.group_members (group_id) where is_super_admin;

-- Picks a Super Admin for a mess that has none (creator first, then the
-- longest-standing Admin, then Moderator, then Member).
create or replace function public._ensure_super_admin(p_group uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if exists (select 1 from public.group_members where group_id = p_group and is_super_admin) then return; end if;
  if not exists (select 1 from public.meal_groups where id = p_group) then return; end if;  -- mess itself being deleted
  select gm.user_id into v_user
    from public.group_members gm
    join public.meal_groups g on g.id = gm.group_id
   where gm.group_id = p_group and gm.status = 'ACTIVE'
   order by coalesce(gm.user_id = g.created_by, false) desc,
            (gm.role = 'ADMIN') desc, (gm.role = 'MODERATOR') desc, gm.joined_at
   limit 1;
  if v_user is null then return; end if;
  update public.group_members set is_super_admin = true, role = 'ADMIN' where group_id = p_group and user_id = v_user;
end;
$$;

-- Backfill existing messes.
select public._ensure_super_admin(id) from public.meal_groups;

-- If the Super Admin's membership disappears (e.g. their account is deleted),
-- hand the title on automatically so a mess is never left without one.
create or replace function public._after_group_member_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_super_admin then
    perform public._ensure_super_admin(old.group_id);
  end if;
  return null;
end;
$$;
drop trigger if exists group_members_keep_super_admin on public.group_members;
create trigger group_members_keep_super_admin after delete on public.group_members
  for each row execute function public._after_group_member_delete();

-- The creator of a new mess is its Super Admin.
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
  insert into public.group_members (group_id, user_id, role, is_super_admin) values (v_group, v_uid, 'ADMIN', true);
  insert into public.members (group_id, id, user_id, name, email, avatar_color)
    values (v_group, public._roster_id(), v_uid, coalesce(nullif(v_full, ''), 'Admin'), v_email, '#0B1F4B');

  return json_build_object('group_id', v_group, 'group_name', v_name, 'invite_code', v_code);
exception
  when unique_violation then
    raise exception 'ALREADY_IN_GROUP';
end;
$$;

-- "Me" now also says whether I'm the Super Admin.
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
    'is_super_admin', gm.is_super_admin,
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

-- Team list: adds is_super_admin and lists the Super Admin first.
drop function if exists public.list_group_accounts(uuid);
create function public.list_group_accounts(p_group uuid)
returns table (user_id uuid, full_name text, email text, avatar_url text, role text, joined_at timestamptz, roster_status text, is_me boolean, is_super_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_group, 'members.view') then raise exception 'FORBIDDEN'; end if;
  return query
    select gm.user_id, p.full_name, p.email, p.avatar_url, gm.role, gm.joined_at,
           coalesce((select m.status from public.members m where m.group_id = gm.group_id and m.user_id = gm.user_id limit 1), 'ACTIVE'),
           gm.user_id = auth.uid(),
           gm.is_super_admin
    from public.group_members gm
    left join public.profiles p on p.id = gm.user_id
    where gm.group_id = p_group and gm.status = 'ACTIVE'
    order by gm.is_super_admin desc, case gm.role when 'ADMIN' then 0 when 'MODERATOR' then 1 else 2 end, gm.joined_at;
end;
$$;

create or replace function public._is_super_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                  where group_id = p_group and user_id = auth.uid() and status = 'ACTIVE' and is_super_admin);
$$;

create or replace function public.change_member_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_current text;
  v_target_super boolean;
  v_admins int;
begin
  if not public.has_permission(p_group, 'roles.manage') then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('ADMIN', 'MODERATOR', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  -- serialize role changes per group so two admins can't demote each other at once
  perform 1 from public.meal_groups where id = p_group for update;
  select role, is_super_admin into v_current, v_target_super from public.group_members where group_id = p_group and user_id = p_user;
  if v_current is null then raise exception 'NOT_A_MEMBER'; end if;
  -- Nobody (not even the Super Admin) changes the Super Admin's role; they hand the title over instead.
  if v_target_super then raise exception 'SUPER_ADMIN_PROTECTED'; end if;
  -- Only the Super Admin creates, changes or demotes Admins.
  if (v_current = 'ADMIN' or p_role = 'ADMIN') and not public._is_super_admin(p_group) then raise exception 'SUPER_ADMIN_ONLY'; end if;
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
  v_target_super boolean;
  v_admins int;
begin
  if not public.has_permission(p_group, 'members.remove') then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.meal_groups where id = p_group for update;
  select role, is_super_admin into v_current, v_target_super from public.group_members where group_id = p_group and user_id = p_user;
  if v_current is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_target_super then raise exception 'SUPER_ADMIN_PROTECTED'; end if;
  if v_current = 'ADMIN' and not public._is_super_admin(p_group) then raise exception 'SUPER_ADMIN_ONLY'; end if;
  if v_current = 'ADMIN' then
    select count(*) into v_admins from public.group_members where group_id = p_group and role = 'ADMIN';
    if v_admins <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  -- Keep their meal / money history, just take them off the active roster.
  update public.members set status = 'INACTIVE' where group_id = p_group and user_id = p_user;
end;
$$;

-- The Super Admin hands the title to another active member of the mess.
-- The new Super Admin becomes an Admin; the old one stays an Admin.
create or replace function public.transfer_super_admin(p_group uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform 1 from public.meal_groups where id = p_group for update;
  if not public._is_super_admin(p_group) then raise exception 'SUPER_ADMIN_ONLY'; end if;
  if p_user = v_uid then return; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and status = 'ACTIVE') then
    raise exception 'NOT_A_MEMBER';
  end if;
  update public.group_members set is_super_admin = false where group_id = p_group and user_id = v_uid;
  update public.group_members set is_super_admin = true, role = 'ADMIN' where group_id = p_group and user_id = p_user;
end;
$$;

-- New functions are executable by PUBLIC by default in Postgres: lock them down.
revoke execute on function public._ensure_super_admin(uuid), public._after_group_member_delete(), public._is_super_admin(uuid)
  from public, anon, authenticated;
revoke execute on function public.transfer_super_admin(uuid, uuid), public.list_group_accounts(uuid) from public, anon;
grant execute on function
  public.transfer_super_admin(uuid, uuid),
  public.list_group_accounts(uuid),
  public.change_member_role(uuid, uuid, text),
  public.remove_group_member(uuid, uuid),
  public.get_my_membership(),
  public.create_meal_group(text, text)
to authenticated;
