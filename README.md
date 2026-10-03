# Family Expense App — مصروف العائلة

Private family finance manager: household, husband, wife and children expenses, income, budgets, recurring items, savings goals and reports.
Arabic (RTL) by default, English (LTR) secondary.

**Stack:** React 19 + Vite + TypeScript · Node.js + Express 5 + TypeScript · PostgreSQL + Prisma 6

> Current status: **Phases 1–5 done** (structure, React/Vite, Express, PostgreSQL/Prisma, schema + seed).
> Next: Phase 6 — authentication.

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
| `SMTP_*`, `MAIL_FROM` | Phase 6 | Email for password reset |
| `UPLOAD_DIR`, `CLOUDINARY_URL` | Phase 9 | Receipt storage |

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

Open http://localhost:5173 — the status page shows the API and database connection, and lets you switch Arabic/English and light/dark/system.

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
3. Framework preset: **Other**. Leave build settings empty (read from `vercel.json`).
4. Environment variables:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Neon pooled URL |
   | `DIRECT_URL` | Neon direct URL |
   | `JWT_SECRET` | random 64+ chars |
   | `JWT_REFRESH_SECRET` | different random 64+ chars |
   | `CLIENT_URL` | `https://<project-name>.vercel.app` |

5. **Deploy**. Check `https://<project-name>.vercel.app/api/health`.

How it works: `client/dist` is served by Vercel's CDN, and `api/index.ts` runs the Express app as one serverless function (all `/api/*` routes).

## Deploy for free (GitHub + Render + Neon) — alternative

1. Create a Neon project (region: Frankfurt). Copy the **pooled** and **direct** connection strings.
2. Locally, with `DIRECT_URL`/`DATABASE_URL` pointing to Neon: `npm run db:migrate -- --name init` then `npm run db:seed`. Commit the migrations folder.
3. Push the repo to GitHub.
4. Render → **New → Blueprint** → select the repo (reads `render.yaml`).
5. Set `DATABASE_URL`, `DIRECT_URL` and `CLIENT_URL` (`https://<service>.onrender.com`). JWT secrets are generated automatically.
6. Every push to `main` redeploys. Free services sleep after 15 minutes idle; the first request after that takes ~1 minute.

---

## Project structure

```text
family-expense-app/
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
