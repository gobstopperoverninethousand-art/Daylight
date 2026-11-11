# Daylight

A portable Next.js / React / TypeScript personal planner built from the Daylight v1.1 specification and the supplied UI sketches. It runs locally; nothing has been deployed.

## Run

Node.js 22 or newer is required. Dependencies are pinned and `package-lock.json` is included in the source folder.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. Use that hostname, rather than `127.0.0.1`, when connecting Google because the supplied `APP_URL` uses localhost.

```sh
npm test
npm run typecheck
npm run build
npm start
```

The app works without accounts in a local browser workspace. “Explore an example” uses a separate sample workspace; sample records cannot be sent to live integrations. The real workspace starts empty. Local records, sample records, and each authenticated user's records have different storage keys.

## Implemented workflows

- Manual planner with Day, Week, Month, a 12-month Year grid, and a Year Columns view; draggable task cards and sessions; a keyboard/touch-accessible Schedule form; deadline markers separate from work blocks.
- Tasks with user-entered effort and remaining-work estimates, optional deadline/project/milestone links, independent sessions, completion history, and a secondary unscheduled task bank.
- Fixed weekday/time routines, pause/resume, individual skip/move exceptions, and independent occurrence outcomes.
- Deadline-first and task-first entry; quick capture from every screen.
- Projects with milestone time budgets and workload estimates in hours, dependencies, explicit date approval, and pacing explanations.
- Move sessions directly in the planner. Drag the top or bottom edge in Day or Week view to resize a session in 15-minute steps.
- Planner includes a collapsible table for the selected day's routines, with an outcome control for each occurrence.
- Return a session with no recorded work to the task list by dragging it back to the priority area or choosing **Put back in task list** in the session editor.
- Inline session outcomes: Completed, Partial (low/medium/high), Blocked, Skipped, and correction back to Not recorded. Optional actual minutes and a short note.
- One daily evidence review, optional self-reported focus/blocker/accomplishment, previous review versions, a structured audit snapshot, and an on-demand seven-day summary.
- Deterministic recommendations and reviews that remain available without AI. Optional real AI priorities, milestone drafts, current-milestone task proposals, and daily assessments. No AI-assigned effort estimates or automatic scheduling.
- Supabase magic-link authentication, per-user cloud persistence, row-level isolation, atomic revision checks, local recovery backups, and JSON export/import.
- Google OAuth, encrypted server-side credentials, calendar selection, recurring events, holiday subscriptions, imported event details and time edits, duplicate prevention, and conflict preservation.

## Cloud storage setup

The additive migration has been applied to the configured Supabase project. All three new `daylight_*` tables are live, anonymous workspace reads are denied, and the older tables remain present. Existing data, `.env.local`, and saved connections were not changed. Authenticated user round-trip storage still requires signing in to Daylight.

For another Supabase project, or to reproduce this setup:

1. Open your project's Supabase SQL Editor.
2. Run [`supabase/migrations/202611070001_daylight.sql`](supabase/migrations/202611070001_daylight.sql). It is additive and repeatable. It was executed twice in a local PostgreSQL test runtime, with tests for RLS, owner isolation, stale revision rejection, and rate limits.
3. In Supabase Authentication URL Configuration, allow `http://localhost:3000/auth/callback` as a redirect URL for local testing. Preserve any existing production URLs.
   The configured project already has site URL `http://localhost:3000` and redirect `http://localhost:3000/auth/callback`. No changes were made to those settings.

4. Open Settings in Daylight and sign in with your email. Local records are not silently merged into the account. Export/import a backup if you want to transfer them.

Supabase API/service-role keys cannot install database tables. A signed-in dashboard, database connection, or authorized management access is required for the migration.

The document table is a versioned JSON aggregate rather than a set of destructive modifications to old tables. The authenticated client can select only its own document and can write only through the compare-and-swap function. Google tokens are stored in a separate server-only table with no client policies.

## Connect Google Calendar

The existing Google credential environment variables are preserved. In the Google Cloud console, enable Calendar API and register this exact redirect URI for the web OAuth client:

```text
http://localhost:3000/api/google/callback
```

Add your Google account as an OAuth test user if the consent screen is in testing. Sign in to Daylight, then use Settings → Connect Google → Check connection → choose a writable calendar → Sync now.

- Sync is **manual**, not a background service.
- The selected calendar is imported from 31 days ago through 366 days ahead. Other calendars are not assumed to be included in capacity.
- The **Include Google holiday calendars** setting is enabled by default. Sync imports visible Google holiday subscriptions for the current and following calendar year. To add a region or observance, [manage holidays in Google Calendar](https://support.google.com/calendar/answer/13748345), then sync in Daylight. Holidays and other events marked free do not consume capacity.
- Routines use one recurring Google event with RRULE. Single-occurrence exceptions use EXDATE, plus a separate event only when moved.
- Deadline markers are all-day, transparent events. An optional due time is recorded in the description and used by pacing calculations.
- Stable, account/calendar/record-derived event IDs prevent duplicate inserts on retries.
- Daylight records carry private ownership tags. Sync updates and deletions require ownership verification and `If-Match` etags. Removing a session in Daylight takes effect in Google on the next sync.
- To delete an imported event, open it in the planner and choose **Delete from Google Calendar**. This applies immediately if the calendar is writable and the event has not changed in Google since sync. For recurring events this deletes one occurrence. Holidays remain read-only.
- To move an imported event, sync once, then drag it to a date or time or choose **Edit date and time**. **Save time in Google** updates only the dates and times of the selected event or occurrence; the other Google fields stay in place. The event details view loads the description, location, guests, meeting links, attachments, and other fields Google makes available to the connected account.
- Changes to Daylight-owned events in Google are flagged for review. Edit the original Daylight session, routine, or deadline, then sync. Conflicting changes are not automatically merged.
- Completed tasks retain their pending sessions with a review flag. Resolving a deadline preserves its Google marker with a completed label.
- Disconnect removes only this app's new stored credentials. It does not revoke the whole shared Google OAuth grant, delete Google events, or touch older saved connections.

## Enable real AI

Google Gemini is the selected provider. Local planning and evidence reviews work without it. To set up Gemini, add these server-only variables to your own `.env.local`, then restart the dev server:

```dotenv
GEMINI_API_KEY=your_private_key
# Optional model override; defaults to this stable model:
GEMINI_MODEL=gemini-3.8-flash
```

Create a key in [Google AI Studio](https://aistudio.google.com/api-keys). Calendar OAuth credentials do not provide Gemini API access. Never use a `NEXT_PUBLIC_` prefix for the key. Sign in to Daylight, then use **Settings → AI assessments → Check Gemini connection** to check the key and model without sending records or generating content.

The adapter uses Google's [generateContent REST API](https://ai.google.dev/gemini-api/docs/generate-content/text-generation) with JSON output and the stable [Gemini 3.8 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Blocked, truncated, empty, and malformed responses are rejected without saving an assessment. No request is sent without a key.

The server sends structured records only when you click an AI action. Saved suggestions, reviews, and proposals are marked **Needs refresh** when their inputs change. Daylight keeps the saved output and waits for a new request. AI routes require authenticated users and enforce database-backed per-user rate limits. Output is validated with Zod; unknown task IDs, invalid dates, dependency cycles, and unsupported shapes are rejected. Milestone proposals stay unapproved; proposed task estimates are supplied by the user.

`lib/server/ai.ts` contains the versioned prompt/rubric. `lib/engine.ts` calculates capacity, overlapping commitments, deadline shortfalls, and evidence counts before any model call. Scheduled duration is never recorded as actual work. Missing or more-than-24-hour-old calendar data prevents an unqualified on-track assessment.

## Verification and boundaries

See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for source, fixture, browser, and live verification status, [`docs/DESIGN_GAPS.md`](docs/DESIGN_GAPS.md) for the master design comparison, and [`docs/DECISIONS.md`](docs/DECISIONS.md) for provisional choices.

No Vercel deployment was performed. The project can run on a normal Node host with `npm run build && npm start`; a future Vercel project should use the standard Next.js preset and the same environment variables with a production `APP_URL` and matching OAuth redirects.

Keep `.env.local`, Google tokens, exported workspaces, and recovery backups private. `NEXT_PUBLIC_*` is restricted to the Supabase public URL and publishable key; service-role, Google secret, token encryption key, and AI key are used only by server modules.
