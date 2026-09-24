# MealMate

Meal, money and mess manager for a small shared household. Tracks deposits, grocery
expenses, daily meals, meal rate, stock, a shopping list and month-end settlement.

Stack: **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 ·
Supabase PostgreSQL + Supabase Auth · Recharts · jsPDF**. Deploys on Vercel.

> `index.html` in the repo root is the **legacy** single-file app (localStorage). It is
> kept untouched for reference and for exporting old data (see *Importing legacy data*).

---

## 1. Local setup

Requirements: Node.js 20+ and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env        # then fill in the values (see section 3)
npx prisma migrate deploy   # creates all tables in your Supabase database
npm run dev                 # http://localhost:3000
```

Sign up on `/signup`. The first sign-in creates your MealMate account row automatically.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (calculations). DB integration tests run when `TEST_DATABASE_URL` is set |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` (uses `DIRECT_URL`) |
| `npm run db:deploy` | Apply pending migrations (use in CI / production) |
| `npm run db:studio` | Browse the database in Prisma Studio |

Integration tests (use a **separate, disposable** database — they create and delete rows):

```bash
DATABASE_URL=<test-db-url> npx prisma migrate deploy
TEST_DATABASE_URL=<test-db-url> npm test
```

---

## 2. Supabase setup

1. Create a project at supabase.com (free tier is enough). Save the database password.
2. **Project Settings → Database → Connection string**
   - *Transaction pooler* (port **6543**) → `DATABASE_URL` — append `?pgbouncer=true&connection_limit=1`
   - *Session pooler* (port **5432**) → `DIRECT_URL` (used only by `prisma migrate`)
3. **Project Settings → API** → copy *Project URL* → `NEXT_PUBLIC_SUPABASE_URL` and the
   *anon public* key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` (later: your production domain)
   - Redirect URLs: add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`
5. **Authentication → Providers → Email**: keep enabled. If *Confirm email* is on, new users
   must click the emailed link before signing in (the app shows a "check your email" screen).
   Supabase's built-in mailer is rate-limited on the free tier — for real use, add SMTP
   under *Authentication → Emails*, or turn off *Confirm email* for a private 2-person app.
6. Run `npx prisma migrate deploy`. The initial migration also **enables Row Level Security
   on every table with no policies**: Supabase's public REST API (anon key) can read nothing,
   while the app's server-side Prisma connection (the `postgres` role) keeps full access.

---

## 3. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Pooled Postgres URL used by the app at runtime |
| `DIRECT_URL` | yes | Direct/session Postgres URL used by `prisma migrate` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key (safe to expose) |
| `NEXT_PUBLIC_SITE_URL` | yes | Base URL for auth email redirects |
| `NEXT_PUBLIC_APP_TIMEZONE` | no | Time zone that defines "today" (default `Asia/Dhaka`) |

Never commit `.env`. `.env.example` lists every variable with placeholders.

---

## 4. Deploying to Vercel (GitHub → Vercel → Supabase)

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project → import the repo**. Framework is detected as Next.js.
   The build command (`npm run build`) runs `prisma generate` automatically.
3. Add all environment variables from section 3 (set `NEXT_PUBLIC_SITE_URL` to the Vercel
   URL or your domain).
4. Deploy. Apply migrations from your machine (or a CI step) with
   `npx prisma migrate deploy` against the production `DIRECT_URL`.
5. In Supabase **Authentication → URL Configuration**, set the Site URL to the production
   URL and add `https://<domain>/auth/callback` to Redirect URLs.
6. Custom domain later: Vercel → Project → **Settings → Domains**, then update
   `NEXT_PUBLIC_SITE_URL` and the Supabase URLs above.

---

## 5. Importing legacy data

1. Open the old `index.html` in the **same browser** you used before.
2. Press F12 → Console and run: `copy(localStorage.getItem("mealmate_db_v2"))`
3. In the new app go to **Profile & Settings → Import from the old MealMate**, paste, and
   click *Import Data* (or save the text as a `.json` file and upload it).

Import only works on an empty account (use *Reset all data* first if needed). Members,
meals, deposits, multi-item expenses, buyers, shopping list, stock carry-forward and
month closings are all imported. Legacy login passwords are **not** imported — accounts
now live in Supabase Auth.

---

## 6. Project structure

```
app/
  (auth)/login, signup      Public auth pages
  (app)/…                   Protected pages: dashboard, money, meals, expenses, members,
                            shopping-list, store, settlement, summary, balance, settings
  actions/                  Server actions (zod validation → services), one file per feature
  auth/callback/route.ts    Email-confirmation handler
components/                 UI: ui/ primitives, shared widgets, charts, feature views
lib/
  calculations.ts           Pure business rules (meal rate, settlement, stock) + tests
  dates.ts, format.ts       Day/month keys in APP_TIMEZONE, currency formatting
  auth.ts, action.ts        Current account, action wrapper (auth + errors)
  supabase/                 Supabase SSR clients + session middleware
  pdf/                      Shopping list & Summary PDF builders (client-side jsPDF)
services/                   Data layer — the only place Prisma is used. Every function takes ownerId
prisma/schema.prisma        Database schema; prisma/migrations/ SQL migrations
types/                      Serialisable DTOs shared by server and client
middleware.ts               Session refresh + route protection
tests/                      DB integration tests
```

Data flow: **page (server component) → service → Prisma → PostgreSQL** for reads, and
**client form → server action → service → Prisma** for writes. Actions call
`revalidatePath`, so pages and charts refresh automatically after every change.

---

## 7. Database schema (summary)

| Table | Purpose |
|---|---|
| `Profile` | One per Supabase Auth user (`id` = auth UUID). Owns everything below |
| `Member` | Mess members: contact, picture, status, **default meals** (breakfast/lunch/dinner) |
| `MealEntry` | Manual meal override for one member-day (days without a row use the member defaults) |
| `Deposit` | Money added by a member; `carriedFromMonth` marks Settlement carry-forwards |
| `Expense` | One purchase trip: date, `month`, total `amount`, note |
| `ExpenseItem` | Items of an expense: category, item, quantity, unit, amount |
| `ExpenseBuyer` | Which member(s) paid / did the shopping ("Done By") |
| `ShoppingListItem` | Category, item, quantity, unit, completed; unique per category |
| `StockCarryForward` | Opening stock carried into a month (from a Store close or a manual correction) |
| `StoreMonthClosing` | Frozen Store snapshot per closed month (history, never deleted) |
| `SettlementClosing` | Frozen settlement snapshot + per-member Paid / Carry-Forward decisions |

Money is `DECIMAL(12,2)`, quantities `DECIMAL(12,3)`, days are `DATE`.
