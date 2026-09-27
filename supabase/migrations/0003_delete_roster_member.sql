-- =====================================================================
-- MealMate — delete a member from the Members list
-- (run AFTER 0001_mealmate.sql and 0002_super_admin.sql; safe to re-run)
--
-- delete_roster_member(group, member, keep_data)
--   * Admins only (members.remove), same Super Admin rules as the Team page:
--     nobody can delete the Super Admin; only the Super Admin can delete an
--     Admin; nobody can delete themselves.
--   * If the member is linked to a login account, that account also loses
--     access to this MealMate (and any pending join request is dropped).
--   * keep_data = true  -> their deposits / meals / guest meals stay in the
--                          records (the mess's money totals don't change).
--     keep_data = false -> those records are deleted too.
-- =====================================================================

create or replace function public.delete_roster_member(p_group uuid, p_member text, p_keep_data boolean default true)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid;
  v_role text;
  v_super boolean;
  v_admins int;
begin
  if not public.has_permission(p_group, 'members.remove') then raise exception 'FORBIDDEN'; end if;
  -- same per-group lock as role changes / removals, so these can't race
  perform 1 from public.meal_groups where id = p_group for update;

  select user_id into v_user from public.members where group_id = p_group and id = p_member;
  if not found then raise exception 'NOT_A_MEMBER'; end if;
  if v_user is not null and v_user = auth.uid() then raise exception 'CANNOT_REMOVE_SELF'; end if;

  if v_user is not null then
    select role, is_super_admin into v_role, v_super from public.group_members where group_id = p_group and user_id = v_user;
    if found then
      if v_super then raise exception 'SUPER_ADMIN_PROTECTED'; end if;
      if v_role = 'ADMIN' and not public._is_super_admin(p_group) then raise exception 'SUPER_ADMIN_ONLY'; end if;
      if v_role = 'ADMIN' then
        select count(*) into v_admins from public.group_members where group_id = p_group and role = 'ADMIN';
        if v_admins <= 1 then raise exception 'LAST_ADMIN'; end if;
      end if;
      delete from public.group_members where group_id = p_group and user_id = v_user;
    end if;
  end if;

  if not coalesce(p_keep_data, true) then
    delete from public.meals       where group_id = p_group and member_id = p_member;
    delete from public.deposits    where group_id = p_group and member_id = p_member;
    delete from public.guest_meals where group_id = p_group and host_member_id = p_member;
  end if;

  delete from public.members where group_id = p_group and id = p_member;
end;
$$;

revoke execute on function public.delete_roster_member(uuid, text, boolean) from public, anon;
grant execute on function public.delete_roster_member(uuid, text, boolean) to authenticated;
