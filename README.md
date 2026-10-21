# Family Expense App — مصروف العائلة

Private family finance manager: household, husband, wife and children expenses, income, budgets, recurring items, savings goals and reports.
Arabic (RTL) by default, English (LTR) secondary.

**Stack:** Expo / React Native · React 19 + Vite + TypeScript · Node.js + Express 5 + TypeScript · PostgreSQL + Prisma 6

The mobile client supports family accounts, child profiles, timestamped lessons, recurring tuition, household expenses, and monthly totals. iOS Siri lesson capture is provided by an App Intent and requires a native iOS build.

---

## Requirements

- Node.js 20+ (22 recommended, see `.nvmrc`)
- npm 10+
- PostgreSQL 15+ — local install, Docker, or a free [Neon](https://neon.com) database

## 1. Install

```bash
npm install
```

## 2. Environment

```bash
cp .env.example server/.env
```

Edit `server/.env`:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | no | `development` / `test` / `production` |
| `PORT` | no | API port (default `5000`) |
| `CLIENT_URL` | yes | Frontend origin for CORS (`http://localhost:5173` in dev) |
| `DATABASE_URL` | yes | Postgres URL used at runtime (Neon: the **pooled** URL) |
| `DIRECT_URL` | yes | Postgres URL used by migrations (Neon: the **direct** URL; locally same as above) |
| `DATABASE_URL_TEST` | tests | Separate DB for tests (Phase 21) |
| `JWT_SECRET` | yes | ≥ 32 random chars |
| `JWT_REFRESH_SECRET` | yes | ≥ 32 random chars, different from `JWT_SECRET` |
| `JWT_ACCESS_EXPIRES_IN` | no | Access token lifetime (default `15m`) |
| `JWT_REFRESH_EXPIRES_DAYS` | no | Refresh token lifetime in days (default `7`) |
| `RESEND_API_KEY`, `MAIL_FROM` | Phase 6 | Email for password reset (Resend; `MAIL_FROM` must be on a domain verified in Resend). `SMTP_*` is an optional fallback |
| `UPLOAD_DIR`, `CLOUDINARY_URL` | Phase 9 | Receipt storage |
| `ANTHROPIC_API_KEY` | no | Reads the paid amount from payment screenshots (Claude). Without it, payments are confirmed but marked "not checked" |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Local Postgres with Docker (optional):

```bash
docker run -d --name family-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=family_expense -p 5432:5432 postgres:16
```

## 3. Database

```bash
npm run db:migrate -- --name init   # creates server/prisma/migrations and applies it
npm run db:seed                     # demo data
```

Demo login (used from Phase 6): **demo@family.app / Demo@12345**

Other DB commands: `npm run db:studio` (browse data), `npm run db:deploy` (apply migrations in production).

> Commit the generated `server/prisma/migrations` folder — production runs `prisma migrate deploy` from it.

## 4. Run

```bash
npm run dev       # API on :5000 + React on :5173 (Vite proxies /api)
npm run server    # API only
npm run client    # React only
```

Open http://localhost:5173 for the web status page. Start the native app with `cd mobile && npm start`.

## 5. Build & start (production)

```bash
npm run build
npm start         # Express serves the API and the React build on one port
```

---

## Deploy for free (GitHub + Vercel + Neon) — recommended

Free domain: `https://<project-name>.vercel.app`, auto-deploys on every push to `main`.

1. Create a Neon project (Frankfurt). Copy the **pooled** and **direct** connection strings.
2. https://vercel.com → **Sign up with GitHub** → **Add New → Project** → import `HomeExpens`.
3. Framework preset: **Other**. Leave build settings empty (read from `vercel.json`). Vercel builds the Expo web client from `mobile/` and serves the Express API from `api/index.ts`.
4. Environment variables:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Neon pooled URL |
   | `DIRECT_URL` | Neon direct URL |
   | `JWT_SECRET` | random 64+ chars |
   | `JWT_REFRESH_SECRET` | different random 64+ chars |
   | `CLIENT_URL` | `https://<project-name>.vercel.app` |
  | `EXPO_PUBLIC_API_URL` | `https://<project-name>.vercel.app/api` for native builds; web uses same-origin `/api` |

5. **Deploy**. Check `https://<project-name>.vercel.app/api/health`.

The Vercel build runs Prisma migrations against the configured production database, exports the Expo web app to `mobile/dist`, and routes `/api/*` to the Express serverless function. A public PostgreSQL database and the environment variables above are required before deployed sign-in and finance APIs will work.

## Deploy for free (GitHub + Render + Neon) — alternative

1. Create a Neon project (region: Frankfurt). Copy the **pooled** and **direct** connection strings.
2. Locally, with `DIRECT_URL`/`DATABASE_URL` pointing to Neon: `npm run db:migrate -- --name init` then `npm run db:seed`. Commit the migrations folder.
3. Push the repo to GitHub.
4. Render → **New → Blueprint** → select the repo (reads `render.yaml`).
5. Set `DATABASE_URL`, `DIRECT_URL` and `CLIENT_URL` (`https://<service>.onrender.com`). JWT secrets are generated automatically.
6. Every push to `main` redeploys. Free services sleep after 15 minutes idle; the first request after that takes ~1 minute.

## Children's points, tasks & rewards (نقاط الأطفال)

Parents evaluate each child with points; the father sets the rules. In the app: **Services → Kids' points**, or the **Points & tasks** button on a child's page. A child signed in with its own account sees only its own board.

| Who | Can |
|---|---|
| Father (admin) | everything below, plus points rules and limits, converting points to money, paying reward money and pocket money, undoing any entry, and the change log |
| Mother / others | whatever the father turns on in **Permissions → Children's points**: *Give points & approve tasks* (`EVALUATE_CHILDREN`), *Manage children's tasks* (`MANAGE_CHILD_TASKS`), *Penalize children* (`PENALIZE_CHILDREN`). New mothers get all three; relatives get none |
| Child | see its own points, tasks, history and reports; mark its tasks done |

How it works:

- **Ledger.** Every change is a row in `child_point_entries` (award, task, penalty, reward, convert, payout, allowance). Balances are always summed from the ledger and never stored. Entries are undone (voided), never deleted.
- **Server-side checks.** Each balance change runs in a transaction that locks the child's row. The server enforces the father's limits: points per award or task, points and money per penalty, a daily penalty cap per child across all parents, and no negative points unless allowed. Points from a rule always come from the rule on the server, never from the client.
- **Tasks** go *pending → completed* (child or parent) *→ approved* (parent). Approving awards the points exactly once. A parent can send a completed task back with a note.
- **Money.** Converting turns points into *reward money* at the father's rate. **Paying reward money** and **pocket money** each create a family expense under *Children → Children's rewards* / *Pocket money*, so monthly totals include them. Money penalties come out of the reward money and are not expenses.
- **Audit log.** Every evaluation, penalty, reward, money action, task change and settings change is written to `audit_logs` in the same transaction. Only the father can read it.

API (`/api/kids`, bearer token):

| Method & path | Purpose |
|---|---|
| `GET /` | children with points, money, rating, open tasks |
| `GET /:childId` | dashboard: balances, level, rating, achievements, 8-week chart, tasks, history |
| `GET /:childId/report?period=week\|month&date=YYYY-MM-DD` | weekly (Saturday start) or monthly report |
| `POST /:childId/points` | `{ ruleId }` or `{ points, reason }` |
| `POST /:childId/penalties` | one of `{ ruleId }`, `{ points }`, `{ amount }`, plus `reason` |
| `POST /:childId/rewards` | `{ ruleId }`: spend points on a reward |
| `POST /:childId/convert` | `{ points }` (father) |
| `POST /:childId/payouts`, `POST /:childId/allowances` | `{ amount, note? }` (father) |
| `POST /:childId/tasks`, `PUT /tasks/:id`, `DELETE /tasks/:id` | create / edit / delete a task |
| `POST /tasks/:id/complete \| approve \| return` | task workflow (`return` takes `{ note? }`) |
| `POST /entries/:id/void` | undo an entry `{ reason? }` |
| `GET/PUT /settings`, `POST /rules`, `PUT/DELETE /rules/:id` | father's rules and limits |
| `GET /audit?childId=` | change log (father) |

The migrations `20261014090000_child_points` and `20261014100000_child_points_notifications` add the tables. Apply them with `npm run db:migrate` locally (`db:deploy` in production; the Vercel build runs it).

---

## Project structure

```text
family-expense-app/
├── mobile/                     Expo + React Native (iOS, Android, web, Siri App Intent)
├── client/                      React + Vite + TS
│   ├── public/                  favicon, preferences-init.js (theme/lang before paint)
│   └── src/
│       ├── components/          Button, Card, PreferenceSwitcher …
│       ├── pages/               StatusPage, NotFoundPage …
│       ├── layouts/             AuthLayout, DashboardLayout (Phase 6/10)
│       ├── hooks/
│       ├── services/            axios instance + API services
│       ├── context/             PreferencesContext (language, theme)
│       ├── utils/               i18n, Intl formatting (money/date/digits)
│       ├── constants/
│       ├── locales/             ar.json, en.json
│       └── styles/              tokens.css, global.css
├── server/                      Express 5 + TS
│   ├── prisma/                  schema.prisma, seed.ts, migrations/
│   └── src/
│       ├── config/              env (zod-validated), prisma client
│       ├── constants/           default categories & payment methods
│       ├── controllers/         HTTP only
│       ├── services/            business logic
│       ├── routes/
│       ├── middleware/          errors, validation, rate limits
│       ├── validators/          zod schemas (Phase 6+)
│       └── utils/               AppError, apiResponse, money (Decimal), dates
├── render.yaml
└── .env.example
```

## Conventions

- **Money** is `Decimal(14,3)` in the DB and a **string** in API JSON. Never use JS floats for amounts.
- **Dates** for transactions are Postgres `DATE` (`"YYYY-MM-DD"`), no timezone shifts. Month boundaries use the family's timezone (default `Asia/Riyadh`).
- **Every query is scoped by `familyId`** from the authenticated user — never from the request body.
- **API response shape**

  ```json
  { "success": true,  "message": "…", "data": {} }
  { "success": false, "message": "…", "code": "VALIDATION_ERROR", "errors": [{ "field": "amount", "message": "…" }], "data": null }
  ```

- **RTL**: CSS uses logical properties only (`margin-inline-start`, `padding-block` …), so layouts flip automatically.
- **Browser storage** holds UI preferences only (theme, language). Financial data lives only in PostgreSQL.
