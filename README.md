# Neuron

Neuron is an offline-capable study companion for university students. It is a Progressive Web App (PWA) built with Next.js and Supabase, with an AI assistant grounded in the course material, ranked quizzes, spaced review, a weekly timetable and a space chat. The interface is available in Arabic (right-to-left), French and English.

It was designed for students in Mauritania, where mobile data is slow and expensive: lessons can be downloaded once and used without any connection, and large PDFs are uploaded in chunks.

Live deployment: <https://neuron-flame.vercel.app> (access is limited to enrolled students).

## Features

- **Lessons and progress**: subjects, sessions (CM / TD / TP / summary), PDF files and per-student progress.
- **Practice (Arena)**: free practice, a ranked quiz (20 questions, 20 minutes), weekly and semester leaderboards, written exercises with self-correction.
- **Mistake review**: every wrong answer enters a spaced-review queue (1 day, 3 days, 1 week, 2 weeks, then mastered).
- **Duel**: asynchronous head-to-head quiz between classmates. No result is revealed to either side until both have finished or the 48-hour deadline passes.
- **AI assistant**: retrieval-augmented chat over the published lessons, guided explanation and review sessions, personal summaries and AI-generated QCM, written-answer correction, student analysis.
- **Timetable**: weekly grid with study-week numbering, English-group filtering and "session tomorrow" notifications.
- **Space chat**: one group chat per space, with moderation (delete, mute) and rate limiting.
- **Recordings**: YouTube (privacy-enhanced mode) or Google Drive links for remote sessions.
- **QCM PDF export**: printable question sheets with an answers page.
- **Offline mode**: the installed app opens without internet and keeps lessons, the timetable and practice available (see below).
- **Admin tools**: content approval flow, question import (CSV / Excel / JSON), account import, statistics dashboards, AI provider diagnostics, storage usage.
- **Notifications**: Web Push with per-type preferences.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, server actions, `proxy.ts` auth gate), React 19, TypeScript |
| Styling | Tailwind CSS v4, `next-themes` (light / dark), RTL and LTR layouts |
| Database and auth | Supabase (PostgreSQL, Row Level Security, Auth, Storage, `pgvector`) |
| Hosting | Vercel (functions pinned to `dub1`, one daily cron job) |
| AI providers | Groq, OpenRouter, NVIDIA NIM, GitHub Models and Gemini behind one fallback chain; Tavily for web search |
| Documents | `unpdf` (PDF text extraction), `read-excel-file`, `papaparse`, KaTeX, `react-markdown` |
| Tests | `node --test` for pure logic, PGlite (in-process PostgreSQL) for the SQL layer |

### AI provider chain

Requests are tried in order until one succeeds. For personal content (student chat, corrections, analysis) the order is **Groq, OpenRouter, NVIDIA NIM, GitHub Models, Gemini**. For non-personal content (for example generated duel questions) Gemini goes first. The chain is defined in `src/lib/ai/chain-order.ts`.

Privacy rules: names, emails and phone numbers are never sent to a provider; student messages are scrubbed of obvious personal data first; providers that train on prompts are not used; OpenRouter requests opt out of data collection. A per-student hidden abuse cap and a "pressure mode" (lower quotas when daily usage nears the free limits) protect the free tiers.

## Folder structure

```
src/proxy.ts                 Session refresh and redirect to the login page
src/app/(app)/...            Protected pages (home, subjects, practice, schedule, profile, assistant, chat, admin)
src/app/actions/...          Server actions (all writes go through here or through SQL functions)
src/app/api/...              Route handlers (AI chat, cron, offline sync, space chat)
src/components/...           UI components
src/lib/ai/...               Provider clients, fallback chain, RAG, prompts, privacy filter, diagnostics
src/lib/offline/...          IndexedDB layer, local grading, sync of offline results
src/lib/i18n/...             Dictionaries (ar / fr / en) and translators
public/sw.js                 Service worker (offline app shell)
supabase/migrations/...      Schema, RLS policies and SQL functions (0001 ... 0028)
supabase/reports/...         Read-only SQL reports
scripts/                     Admin creation, icon generation, i18n check
tests/                       Unit tests (tests/*.test.mjs) and SQL tests (tests/sql/phase*.mjs)
.github/workflows/           Keep-alive ping and a fallback for the daily notification job
```

## Run locally

Requirements: Node.js 22 or newer and a Supabase project (the free tier is enough).

```bash
npm install
# create .env.local with the variables listed in the next section
npm run dev                    # http://localhost:3000/login
```

Create the first admin account once (it reads the keys from `.env.local`):

```bash
node --env-file=.env.local scripts/create-admin.mjs "Full Name" you@example.com 'a-strong-password'
```

From the admin panel you can then create moderators and students.

## Environment variables

Only the **names** are listed here. Values belong in `.env.local` (never committed) and in the Vercel project settings. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS: keep it server-side and never share it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | yes | Public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only key for admin actions and indexing |
| `APP_TIMEZONE` | recommended | Time zone for "today", "now" and the weekly ranking (for example `Africa/Nouakchott`) |
| `MULTI_SPACE_ENABLED` | no | `true` re-enables multi-space mode (see below) |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `GITHUB_MODELS_TOKEN`, `GEMINI_API_KEY` | at least one | AI providers |
| `TAVILY_API_KEY` | no | Web search for the assistant |
| `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `RAG_MIN_SIMILARITY` | no | Model and retrieval tuning |
| `AI_LIMIT_<PROVIDER>_DAILY` | no | Approximate daily request limits used by pressure mode and the usage bars |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | Web Push keys (generated from the admin panel) |
| `CRON_SECRET` | for push | Protects `/api/cron/notify` |
| `STORAGE_LIMIT_BYTES` | no | Storage quota shown on the admin storage card |

GitHub Actions secrets (only for the two workflows): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`, `CRON_SECRET`.

## Database migrations

Run the files in `supabase/migrations/` in numeric order from the Supabase SQL Editor: `0001`, `0002`, ... up to `0028`. Every file after `0002` is idempotent and safe to run twice.

**Never re-run `0002_grants.sql` after `0003`.** Its blanket `select` grant would undo the column-level protection of `questions.correct_index` and `questions.explanation`. If that ever happens, re-run the `revoke select ... / grant select (...)` statements at the top of `0003`.

Highlights:

| Range | Content |
| --- | --- |
| 0001 - 0004 | Core schema, grants, Arena (attempts, scoring, ranking, spaced review), keep-alive ping |
| 0005 - 0009 | AI assistant: RAG chunks, conversations, guided sessions, usage limits, last provider errors |
| 0010 - 0013 | Recordings, announcements, Duel, push notifications, admin statistics |
| 0014 - 0016 | English locale, semester start date, QCM PDF export |
| 0017 - 0020 | Spaces (major x level), RLS isolation per space, dashboards, remaining subjects |
| 0021 - 0024 | AI platform: abuse guard, space chat, personal QCM, AI-generated duels |
| 0025 - 0028 | Offline score sync, file-size limit removal, single-space mode, multipart files |

`0027_single_space_down.sql.txt` is a manual rollback for `0027` and is never run automatically.

## Single space and the `MULTI_SPACE_ENABLED` switch

A "space" is a major x level (for example "IAA L2"): a row in `cohorts` with its own subjects, timetable, announcements, ranking and a set of plan features. RLS isolates spaces from each other in the database.

The platform currently runs a single space. With `MULTI_SPACE_ENABLED` unset or `false` there is no space choice at login, no space management page and no space switcher. The multi-space code stays in the repository and is re-enabled by setting `MULTI_SPACE_ENABLED=true`. Migration `0027` makes every other space inactive without deleting anything.

## Offline mode

- A service worker (`public/sw.js`) downloads the full `/offline` app shell (HTML, JS, CSS, fonts, icons, manifest) into a cache named after the build. A new version replaces the old one only after its shell has been downloaded completely.
- Navigation is network-first with a three-second timeout, then falls back to the local shell, so the installed app cold-starts with no connection.
- User-specific pages are never cached by the service worker. Personal data lives in IndexedDB on the device and is wiped on logout or account switch.
- Students can download lesson packs (PDFs and QCM sets). Offline QCM results are graded locally and queued; they are synced later through `record_offline_scores` (practice only, never the ranking).
- The offline banner is hidden inside the local app, which already runs without a network.

## Large file upload

Supabase Storage limits an object to 50 MB on the free plan. Files above 45 MB are split in the browser into parts of at most 45 MB, uploaded directly to Storage with progress and per-part retry (so they never pass through a serverless function), and stored as one logical file (`part_count > 1`, `<lessonId>/<fileId>/part-001 ...`). Part hashes are verified when the parts are joined for viewing. Large PDFs are indexed for the assistant from the browser in small page batches, so no request exceeds the function time limit.

## Tests

```bash
npm test               # unit tests (node --test)
npm run test:sql       # SQL layer: applies all migrations in PGlite (twice, to check idempotency) and checks RLS, grants and functions
npm run check:i18n     # every key exists in ar / fr / en, no empty value, every t("...") call resolves
npx tsc --noEmit       # type check
npx eslint .           # lint
npm run build          # production build (runs check:i18n first)
```

## Deployment

1. Create the Supabase project, run the migrations in order, and add the Redirect URL `https://<your-domain>/auth/callback` under Authentication > URL Configuration.
2. Import the repository in Vercel and set the environment variables above. `vercel.json` pins functions to `dub1` (close to Supabase `eu-west-1`) and schedules `/api/cron/notify` daily at 17:00 UTC.
3. Create the first admin with `scripts/create-admin.mjs`.
4. Optional: add the GitHub Actions secrets so `keep-alive.yml` pings the database every three days (free Supabase projects pause when idle). `notify-backup.yml` is a manual or scheduled fallback if Vercel Cron is unavailable on your plan.
5. After uploading old PDFs, use "Re-index all" in the admin AI panel to build the assistant's search index.

Other operational notes: the subject and semester catalog is cached for one hour (`src/lib/catalog.ts`); session verification uses `getClaims()`, which is local (no network call) when the Supabase project uses asymmetric JWT signing keys.

## Design notes

- **Phone login**: a phone number is only an identifier (no SMS). It is mapped to an internal email `<digits>@phone.neuron.local`, and the last 8 digits are matched at login.
- **Publishing**: content uploaded by a moderator is "pending approval" (database trigger) unless the moderator has the direct-publish permission. Students only see published content (RLS).
- **Server-side grading**: answers are graded by SQL functions (`submit_answer`, `duel_answer`, ...). Students cannot read `correct_index` or `explanation` and cannot write to attempt tables directly, so scores cannot be forged from the browser.
- **Next.js 16**: `middleware` is now `src/proxy.ts`, and Cache Components are disabled because every page is behind login.

## License and status

This is a private project that serves real students. See `AGENTS.md` for notes for AI coding agents working in the repository.
