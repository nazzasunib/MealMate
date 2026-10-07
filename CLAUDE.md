# MealMate — Handoff for a new Claude account

> Put this file in the repo root as `CLAUDE.md` (D:\NIS\NIS Claude\Meal Mate\CLAUDE.md) so Claude reads it automatically.
> Written 1 Oct 2026. Everything below is the state at commit `e0059a1` on `main`.

## 1. What MealMate is

A shared mess (shared-house) manager for Bangladesh: daily meals (Breakfast/Lunch/Dinner on/off), guest meals, bazar expenses, money deposits, shopping list, store stock, settlement (who owes whom), monthly summary + PDF, team roles, notifications, and meal-off / guest-meal requests. Several people log in to the same "MealMate" (= a group / mess).

- **Owner:** Nazzas Ibn Shams Unib — GitHub `nazzasunib`, git email `mdnazzas@gmail.com`
- **Talk to the owner in Banglish** (Bangla written in English letters), short and clear. He writes requests like "kore deo", "push kore deo".
- **Website (live):** https://meal-mate-woad.vercel.app  (app lives at `/app#/dashboard`)
- **Android download page:** https://meal-mate-woad.vercel.app/download
- **APK direct:** https://github.com/nazzasunib/MealMate/releases/download/latest-apk/MealMate.apk
- **GitHub repo:** https://github.com/nazzasunib/MealMate (branch `main`)
- **Local folder (owner's Windows PC):** `D:\NIS\NIS Claude\Meal Mate`
- **Supabase project ref:** `fdczkjosxzlxykqtazly`
- **Vercel:** project auto-deploys every push to `main` (GitHub integration). No Vercel login is needed to deploy.

## 2. Stack

- Next.js 15 (App Router) + React 19, TypeScript for the shell, **vanilla JS engine** for the app screens.
- Supabase: Postgres + Row Level Security + RPC functions + Auth (email/password) + Realtime broadcast.
- Vercel hosting (static/edge).
- Android: Capacitor 8.5.2 WebView wrapper that loads the **live website** (`server.url` in `capacitor.config.json`), appId `com.niduslab.mealmate`.
- jsPDF for PDFs (loaded on demand).

## 3. Repo map

| Path | What |
|---|---|
| `lib/engine/engine.js` (~5.7k lines) | The whole app UI + logic. String-HTML rendering, `render()` per hash route, event delegation via `data-action`. Permissions via `ACTION_PERMS`, `WRITE_ACTIONS`, `applyPermissionUI`. |
| `lib/engine/sync.js` | Keeps the in-memory `DB` object and diff-syncs changed rows to Supabase (table adapters `toDb/fromDb`), Realtime broadcast between devices, **activity-log lines** (`describeChanges`). |
| `lib/engine/icons.js` | Lucide SVG strings (`icon(name, cls)`; an SVG needs a `class="lucide ..."` attribute for sizing). |
| `components/AppHost.tsx` | Boots the session, loads the group, creates sync, builds `ctx.api` (all RPC calls), mounts the engine. |
| `lib/errors.ts` | `friendlyError()` — maps RPC error codes (FORBIDDEN, PAST_DATE, …) to user text. |
| `app/layout.tsx` | Early inline script that adds `mm-app` class to `<html>` in app mode; PWA/iOS meta. |
| `app/legacy.css` | **Precompiled** original stylesheet. There is **no Tailwind build** in MealMate — a Tailwind class that isn't already in legacy.css does nothing. Put new styles in `app/mealmate.css` (custom classes). |
| `app/mealmate.css` | New styles (auth pages, notifications, requests, shopping price, Bengali font, website-only tweaks). |
| `app/app-mode.css` | Styles for the Android/iPhone app layout only — every rule scoped to `html.mm-app`. |
| `app/fixes.css` | Small global fixes. |
| `app/download/page.tsx` | Public APK download page (Android steps, iPhone "Add to Home Screen" steps, in-app-browser detection). |
| `app/manifest.ts` | PWA manifest (iPhone home-screen install). |
| `app/login, create, join, start, forgot, reset` | Auth/onboarding pages. `/dashboard` redirects to `/app`. |
| `supabase/migrations/0001…0004` | Database (run in order in Supabase SQL Editor). |
| `supabase/tests/*.sql` | SQL tests (run on a local Postgres after `stub_supabase.sql` + migrations). |
| `android/` | Capacitor Android project. `android/app/src/main/java/com/niduslab/mealmate/DownloaderPlugin.java` = native file saving. |
| `.github/workflows/build-apk.yml` | Builds the APK on GitHub Actions and publishes release `latest-apk`. |
| `public/fonts/noto-sans-bengali.woff2` | Bundled Bengali font (SIL OFL), loaded only when Bengali text appears. |
| `legacy/index.html` | The original single-file app (reference only). |

Engine routes (hash): `dashboard, money, meals, requests, expenses, members, shopping-list, store, hisab (Settlement), summary, team, balance, settings/password`.

## 4. Database (Supabase)

Migrations — the **owner runs them himself** in Supabase → SQL Editor (paste whole file → Run). Applying migrations through the dashboard API from Claude was blocked earlier; don't try to work around that. Give him the file and wait for "Done", then verify (see §8).

| File | Adds |
|---|---|
| `0001_mealmate.sql` | profiles, meal_groups, group_invites, group_members, role_permissions, members, meals, guest_meals, deposits, expenses, shopping_items, store_carry_forward, store_closed_months, money_closed_months, settlements, invite_attempts; RLS; join/approve/role RPCs. |
| `0002_super_admin.sql` | One Super Admin per mess (`group_members.is_super_admin`): can't be removed/demoted, only they manage Admins, can hand the title to someone else (`transfer_super_admin`). |
| `0003_delete_roster_member.sql` | `delete_roster_member` (Admin chooses keep/delete money records; Admins only). |
| `0004_activity_and_requests.sql` | `activity_log` (notifications; author stamped by DB trigger; 60-day retention via `list_activity`), `meal_requests` + `create_meal_request / cancel_meal_request / decide_meal_request` (approve applies meal-off or adds guest meal). **Already run on production (1 Oct 2026).** |

Roles (table `role_permissions`): ADMIN = everything; MODERATOR = reports.view, members.view, members.manage, meals.edit, expenses.create, shopping.manage, stock.edit; MEMBER = reports.view. Super Admin is an ADMIN with the flag.

## 5. Feature notes / design decisions (don't break these)

- **Website vs app UI:** the Android app (and iPhone home-screen app) gets its own layout: royal-navy bottom bar (Dashboard, Meals, Expenses, Settlement, More), More sheet, tables turned into stacked cards (`appStackTables`). Detected by user-agent `MealMateApp` (Capacitor `appendUserAgent`), the Capacitor bridge, `navigator.standalone`, or `?app=1` (preview; `?app=0` turns off). **When the owner says "only APK" or "only website", scope CSS to `html.mm-app` / `html:not(.mm-app)` and verify the other one is unchanged.**
- **APK loads the live site** → web changes need **no APK rebuild**. Only changes under `android/`, `capacitor.config.json`, `package*.json` trigger the CI build, and users must reinstall from `/download`.
- **Downloads in the app:** Android WebView ignores blob/data downloads, so PDFs/backups go through the native `Downloader` plugin (`saveFileInApp()` in engine.js) → saved to `Download/MealMate`, with an "Open" toast. Website keeps normal browser downloads.
- **Categories:** 9 categories (Fish & Meat, Vegetables, Grocery, Spices, Fruits, Dairy & Breakfast, Beverages, Household, Gas & Fuel), items A–Z, each ending with "Others". Item names are **stored in English**; Bengali is display-only via `ITEM_BN` + `itemLabel()` → "Chicken (মুরগি)".
- **Shopping list price:** stored inside the existing `quantity` text column as `qty\u001Fprice` (see `encodeShopQty/decodeShopQty` in sync.js) — no DB column. Estimated total under the list and in the PDF.
- **PDF Bengali:** jsPDF can't shape Bengali, so Bengali names are drawn on a canvas (`bengaliPdfImage`) and placed as images. Money in PDFs is written "Tk" (no ৳ glyph in Helvetica).
- **Profile photos:** member avatars use the linked account's profile photo (`memberPic()` → profiles.avatar_url via `ctx.api.listProfilePictures`), then the Admin-set member picture, then initials.
- **Notifications (bell):** lines written after each save by `sync.js` (`describeChanges`, deduped for 3 min) and by request RPCs. "Mark all as read" button (read state per device in localStorage). Exact time shown.
- **Meal requests:** members request Meal Off (date/range + meals) or Guest Meal; Admin/Moderator approve/reject; exact "Requested on …" time + "Same-day request" tag.
- **Dashboard (website only):** equal-height stat cards, wider gap between quick-action pills.
- Bengali font: Noto Sans Bengali bundled; `--font-sans` includes it.
- **Offline mode (Oct 2026):** web + app work without internet after one online visit on that device.
  - `public/sw.js` (service worker, registered by the inline script in `app/layout.tsx`) keeps `/_next/static`, fonts, icons (cache-first) and pages `/app`, `/login`, `/` (network-first, saved copy when offline). The page posts the files it loaded (`performance` entries) so lazily loaded chunks (engine, sync) are kept too. Bump `VERSION` in sw.js to drop old caches. `/sw.js` is served `no-cache` (next.config.mjs).
  - Data: `AppHost` keeps `mealmate-cache:<uid>` = `sync.exportState()` (the data **plus `__base`, the last server copy**) and `mealmate-boot:<uid>` (membership + profile). Offline boot uses the saved session from `mealmate-auth` when the token can't be refreshed.
  - `sync.js`: unsaved edits = diff between data and base, so edits made offline survive closing the app. `load()` rebases unsaved edits on top of fresh server rows and then saves them (last write wins). `flush()` skips the network while `navigator.onLine === false`; the `online` event sends everything.
  - Needs internet (shows "You're offline…"): meal requests and approvals, Team & Invites, join/approve, profile/password, backup import, notifications list.
- **Theme:** light/dark switch in the top bar (`mm-theme` in localStorage, applied before paint). Dark = navy page + light stat cards (`html.mm-dark` rules at the end of `app/mealmate.css`). The Synced badge is hidden unless offline / not saved.

## 6. How to make a change and ship it (the usual flow)

1. Edit files in `D:\NIS\NIS Claude\Meal Mate` (or in a cloud copy, then copy the changed files back).
2. Check: `node --check lib/engine/engine.js`, then `npm run build` with dummy env if building in the cloud:
   `NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build`
3. Test in a browser (Playwright with mocked Supabase routes worked well — app mode = add `MealMateApp` to the user agent, width 390).
4. Commit + push from the owner's PC (PowerShell, Windows git already signed in to GitHub):
   ```powershell
   cd 'D:\NIS\NIS Claude\Meal Mate'
   git add <files>
   git -c user.name=nazzasunib -c user.email=mdnazzas@gmail.com commit -m "Short title" -m "What and why"
   git push origin main
   ```
5. Vercel deploys in ~1 minute. Verify from the PC (the cloud sandbox can't reach *.vercel.app): fetch the site and check the new code is in the JS chunks.
6. If `android/**` changed: watch GitHub Actions (`https://api.github.com/repos/nazzasunib/MealMate/actions/runs`) → release `latest-apk` updates; tell the owner to reinstall from `/download`.
7. Report to the owner in Banglish: what changed, where, what he must do (if anything), and whether a new APK is needed.

## 7. Permissions / setup the new Claude account needs

1. **Claude desktop app on the owner's PC**, task started with "this computer" linked.
2. **Connect the folder** `D:\NIS\NIS Claude\Meal Mate` (and `D:\NIS\NIS Claude\Task Management`) — "Add folder" in Cowork. Read/write.
3. **Desktop Commander** (or another way to run Windows PowerShell) enabled — `git push` must run in **Windows**, because that's where the GitHub login (Git Credential Manager) lives. The Linux shell attached to connected folders has no GitHub credentials, so it can commit but not push.
4. **Git for Windows** installed and signed in as `nazzasunib` (already true on this PC). Never ask for or type the password/token.
5. **Network:** GitHub, Supabase and Vercel must be reachable from the PC. (From the cloud sandbox, *.vercel.app is blocked — verify live deploys from the PC.)
6. **Supabase SQL:** the owner runs migrations himself in the SQL Editor; Claude only writes/tests the SQL.
7. **GitHub Actions** needs `contents: write` (already in the workflow) to publish the APK release.
8. No secrets are needed in the repo. Vercel env vars (already set): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`.

## 8. Verifying a migration ran (no login needed)

Call the RPC with the public anon key (find it in the site's JS chunk next to the project URL). If the function exists you get **401 "permission denied for function …"** (anon is blocked on purpose); if it doesn't exist you get **404 PGRST202 "Could not find the function"**. Same for tables (permission denied vs PGRST205).

## 9. Owner's rules (learned the hard way)

- Ask a clarifying question before big builds (use multiple-choice); for small fixes just do it.
- "APK only" / "website only" means exactly that — check the other side is unchanged.
- CI/build fixes: find the root cause; **don't randomly change versions**, no `|| true`, no fake files, no hidden errors.
- Never delete user data unless he explicitly asks; never type passwords.
- He tests on a real phone — say clearly what was tested with mocks vs on real data.
- Keep the website fast; the app must not move sideways on phones (no horizontal scroll).

## 10. Known leftovers

- `supabase/tests/test_rls.sql` predates the join-approval flow and fails — pre-existing, not a regression.
- A "pages build and deployment" GitHub workflow also runs on push (GitHub Pages leftover); harmless.
- APK is a debug build (not Play-Store signed).
- iPhone: no native app; Safari "Add to Home Screen" gives the app layout.
