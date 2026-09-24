# MealMate — multi-user (Next.js + Supabase + Vercel)

Your original MealMate app (every page, calculation, colour and rule from `legacy/index.html`) running on a real shared backend. Several people can now log in to the same MealMate from different devices, with Admin / Moderator / Member roles and invites by code or link.

---

## 1. Setup (about 10 minutes)

### A. Supabase (database + login)
1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of `supabase/migrations/0001_mealmate.sql`, then click **Run**. It's safe to run again.
3. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://YOUR-APP.vercel.app`
   - **Redirect URLs:** add `https://YOUR-APP.vercel.app/**` and `http://localhost:3000/**`
4. **Authentication → Providers → Email**: "Confirm email" works either way.
   - **ON (recommended):** new users confirm by email first. Their MealMate is created (or joined) automatically once they confirm, even if they open the link on a different device.
   - **OFF:** people go straight to the dashboard after signing up.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### B. Run locally
```bash
cp .env.example .env.local      # paste your URL + anon key
npm install
npm run dev                     # http://localhost:3000
```

### C. GitHub + Vercel
```bash
git init && git add . && git commit -m "MealMate v3"
git remote add origin https://github.com/YOU/mealmate.git
git push -u origin main
```
In Vercel: **Add New → Project →** import the repo. Under **Environment Variables**, add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `NEXT_PUBLIC_SITE_URL` | `https://YOUR-APP.vercel.app` (this is used in invite links) |

Then deploy. Every `git push` redeploys automatically.

### D. Moving old data across (optional)
If the old app was used in a browser, open it there, press F12 → Console, and run
`copy(localStorage.mealmate_db_v2)`. Paste the copied text into a file called `old.json`. Then, as Admin, go to **Profile & Settings → Backup → Import Backup** and choose that file.
(If the new app runs on the same domain the old one did, the page offers "Import from this device" instead.)

---

## 2. What was built

### Files
| Path | What it is |
|---|---|
| `lib/engine/engine.js` | The original MealMate app logic and screens, kept intact. Changes: storage now goes through Supabase, the fake login was removed, role checks were added, the Team & Invites page and Backup/Import were added, jsPDF loads only when needed, and the "MEALMATE" pixel-word background was removed on request. |
| `lib/engine/sync.js` | Compatibility layer. It keeps the original in-memory `DB` shape and diff-syncs only the changed rows to Supabase. It also handles live refresh across devices. |
| `lib/engine/icons.js` | The original icon set. |
| `app/legacy.css` | The original stylesheet, with the embedded fonts moved to `/public/fonts`. The file went from 216 KB to 37 KB. |
| `app/mealmate.css` | New styles for the auth pages, splash screen, invite cards, sync badge and animations. |
| `components/AppHost.tsx` | Mounts the app: checks the session, loads the group's data, handles role changes, and wires in live sync, the cache and the offline indicator. |
| `app/login`, `app/create`, `app/join`, `app/join/[code]`, `app/start`, `app/forgot`, `app/reset` | The new authentication pages. |
| `supabase/migrations/0001_mealmate.sql` | Tables, permissions, Row Level Security and RPCs. |
| `supabase/tests/*.sql` | Database security tests (run against local Postgres). |
| `legacy/index.html` | Your original file, kept for reference. |

### Database tables
`profiles`, `meal_groups`, `group_invites`, `group_members`, `role_permissions`, plus the data tables `members`, `meals`, `deposits`, `expenses`, `shopping_items`, `store_carry_forward`, `store_closed_months`, `money_closed_months`, `settlements` and `invite_attempts`. Every data row carries `group_id`, and every primary key starts with it.

### localStorage → Supabase mapping
| Old `mealmate_db_v2` key | New table |
|---|---|
| `members` | `members` (roster). Login accounts are linked through `user_id`. |
| `meals` | `meals` (one row per member per day, created only when a day differs from that member's default) |
| `deposits` | `deposits` |
| `expenses` (including old single-item rows) | `expenses` (`items` jsonb). Old single-item rows are converted automatically. |
| `shoppingList` | `shopping_items` |
| `storeCarryForward` / `storeClosedMonths` | `store_carry_forward` / `store_closed_months` |
| `moneyClosedMonths` / `settlements` | `money_closed_months` / `settlements` |
| `users` (plain-text passwords) | **Removed.** Supabase Auth handles logins now. |
| `mealmate_session_v2` | **Removed.** This is now the Supabase session. |

Meal rates and balances are still calculated live, exactly as before. Month-close snapshots are stored in `settlements`.

### Authentication flow
- **Login:** email + password. You can also choose Create New MealMate or Join Existing MealMate from here.
- **Create:** fill in name, email, password, confirm password and MealMate name. The app creates the user, then the group, makes you ADMIN, links you to the group and generates an invite code and link. You land on the Admin dashboard.
- **Join:** enter a code (`MM-7K29PX`), or open `/join/MM-7K29PX`. You see the MealMate's name first, then register or log in. You join as MEMBER and land on the dashboard.
- Sessions persist across visits. Logout, forgot password and reset password all work. If someone isn't logged in, `/app` sends them to `/login`.

### Invite system
The Admin gets a Team & Invites page (plus an invite card on the dashboard) with:
- Copy Invite Code, Copy Invite Link and Share
- **Generate New Code:** the old code stops working immediately
- A pause/resume switch for invites

Brute-force guard: after 20 wrong codes in an hour, the account or IP is blocked for the rest of the hour.

### Roles
| | Admin | Moderator | Member |
|---|:-:|:-:|:-:|
| View everything (dashboard, meals, expenses, shopping, balance, reports) | ✓ | ✓ | ✓ |
| View team | ✓ | ✓ | – |
| Meals on/off, add expenses, shopping list, stock | ✓ | ✓ | – |
| Edit/delete expenses, deposits, month closing, settings, roster | ✓ | – | – |
| Invite, change roles, remove members | ✓ | – | – |

Permissions live in the `role_permissions` table. To expand a role later, insert a row there.

The last Admin can never be demoted or removed. The app asks for confirmation before removing someone or changing an Admin's role. Signup has no role field, and `group_members` can't be written from the browser at all.

### RLS policies
- Every table has RLS enabled.
- **Reads:** `group_id IN (SELECT my_group_ids())`. This check runs once per query, not once per row, so it stays fast as data grows.
- **Writes:** `group_id IN (SELECT my_groups_with('<permission>'))`.
- Groups, memberships and invites have **no** write policies. Changes go only through `SECURITY DEFINER` RPCs that check the caller's role.
- Anonymous users can call only `get_invite_preview`, which returns a group name and nothing else.

### Multi-device
- All shared data lives in Supabase.
- After every save, a tiny Supabase Realtime broadcast tells the other devices which tables changed, and they re-fetch just those tables. No data travels over the broadcast.
- Devices also catch up when the app regains focus, when the network comes back, and every 60 s while the app is visible.
- If someone is typing or has a modal open, the update waits until they finish.
- The top bar shows **Synced / Saving / Offline / Not saved**.

### Speed
- All pages are static on Vercel's CDN.
- The app code downloads while the first queries run.
- On repeat visits, the last data paints instantly from a device cache and is then refreshed live. The cache is cleared on logout.
- jsPDF (about 350 KB) loads only when someone exports a PDF.

---

## 3. Testing done
- **SQL security suite:** `supabase/tests/test_rls.sql`. Run it against local Postgres with the Supabase stub.
- **End-to-end tests** (Chromium, real PostgREST + Postgres). These passed with no console errors:
  - Admin: create, validation, dashboard invite, deposit, expense, meal, shopping, reload persistence, Team page, regenerate code, pause invites, remove member, profile, password, backup, rename, PDF export, store close, settlement close, legacy import.
  - Member: joins by link on mobile, is read-only, is redirected away from /team, can't write through the API (403), and can't self-promote (FORBIDDEN).
  - Moderator: adds meals, expenses and shopping items; can't delete, touch deposits or close months; sees Team read-only.
  - Other checks: the last Admin is protected, both email-confirmation paths work (including cross-device), one account = one MealMate, other groups' data stays invisible, and a removed user is sent to `/start`.

## 4. Notes / TODO
- Live cross-device updates use Supabase Realtime Broadcast, which is enabled by default. If it's ever unavailable, the focus/60-second refresh still keeps devices in sync.
- Profile and member pictures are stored as small compressed images (256 px JPEG) in the database, the same as before. For very large scale, moving them to Supabase Storage is a good next step.
- Two people editing the *same* item at the same moment: the last save wins, per item (a meal-day, an expense, a deposit). Different items never overwrite each other.
- One account belongs to one MealMate (v1). The schema is ready for more later.
