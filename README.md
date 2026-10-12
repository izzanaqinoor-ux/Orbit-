# Orbit

A time-management system for student-workers. You are the sun; Study, Work and
Personal commitments orbit you, and Orbit shows how much of your week they
claim. Time only (V1).

- `backend/`  FastAPI + PostgreSQL + SQLAlchemy + Alembic (see `backend/docs/orbit-schema-spec-v1.md`)
- `frontend/` React + TypeScript + Tailwind (Vite)

## Run locally
Backend (needs PostgreSQL 15+):
```
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then edit DATABASE_URL / SECRET_KEY
alembic upgrade head
uvicorn app.main:app --reload
```
Frontend:
```
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://127.0.0.1:8000
npm run dev                 # http://localhost:5173
```
Tests: `cd backend && pip install -e ".[dev]" && pytest`

## Deploy
See `DEPLOY.md`.

## Finance
Finance is built around your own rules (cap, liquidity floor, portfolio targets, pockets, goals, milestones), all editable and versioned. See `backend/docs/orbit-finance-spec-v3.md`. Planets (categories), school terms and finance tables are created by the same `alembic upgrade head` run, so there are no extra deploy steps.

### Recent additions
- **Time-cost of money** — Planning and the wishlist show prices as hours of work at your hourly job rate (best-paid hourly job).
- **What if…** — sliders on Funds: work N more hours a week / spend less, and see goal dates move. Pure arithmetic, nothing saved.
- **Exam focus** — tick "This is an exam" on a fixed study commitment. Within `exam_focus_days` (Finance → Rules, default 7, 0 = never) Orbit hides the term/valuation reminders and shows only cap and liquidity warnings.
- **Weekly review** — plain facts for any week: hours, money, what moved. Surfaces automatically on Sundays; reachable any day from This week.
- **Your data** — header button; downloads everything as JSON (no password hash) or all money entries as CSV.
- **Bank statement import** (Finance → Activity → Import) — CSV only (PDF statements aren't read). One file per account, any number of files per month. The browser parses the file; the server classifies each line:
  - `imported` — already uploaded before (fingerprint of account + date + amount + description, with an occurrence index for identical same-day lines), so overlapping uploads are safe;
  - `logged` — matches an entry you typed in (same account and amount within 2 days, one-to-one);
  - `paired` — an outflow in one account and an equal inflow in another within 3 days become **one** transfer entry, so the total never changes;
  - `new` — you pick expense/income + category, mark it as a move to another account, or skip. Categories are remembered per merchant.
  After commit, Orbit compares the bank's closing balance (if the file has a balance column) with its own.
  Endpoints: `POST /fin/import/preview`, `POST /fin/import/commit`, `GET /fin/import/summary`. Migration `d4f7b2a9e611`.

### Make Orbit yours (feature choices) and tester feedback
- First login shows **Make Orbit yours**: pick a start (Student / Office worker / Everything) and tick the parts you want (Study & exams, Work & pay, Money, Investing, Can I afford it?, Bank import, Special occasions, Weekly review). Reopen it any time from the header. Switching a part off only hides it; nothing is deleted. Stored per user in `users.features` / `users.onboarded`; API: `GET/PUT /preferences`.
- Investing, Planning and Import need Money. Turning Money off removes the Finance tab and the Finance planet on the Orbit sky.
- **Notes** button on every screen: a small list for jotting thoughts as they come (tick off, delete). "For me" notes are private; "About Orbit" notes also record the screen and reach the maker. API: `GET/POST /notes`, `PATCH/DELETE /notes/{id}`. Set `ADMIN_EMAIL` and download the "About Orbit" notes at `/admin/feedback.csv` as that user.
- Account actions (Make Orbit yours, Your data, Sign out) live in the planet menu, top right.
- Migrations `e5a1c9b7d304` and `f6b2d8c4e105` (notes replace the earlier feedback table; the seeded "Earlier four-asset framework" rule set and its Rule history card are gone). Test plan for family testers: `backend/docs/usability-test-plan.md`.

### Editing, Study plans and main job
- **Edit anywhere.** Click any event on the Calendar and press Edit; drag on an empty slot to create an event; drag a block's bottom handle to lengthen it. Commitments has an Edit button too. API: `PATCH /commitments/{id}`, `PATCH`/`DELETE /time-blocks/{id}`.
- **Study tab** (between Calendar and Commitments, shown when "Study & exams" is on). Upload an assignment brief, or lecture PDFs for an exam, and Orbit proposes pieces and spreads them across the days before the deadline (avoiding what's already scheduled). Long lectures are split into sessions, each noting where to continue from; "Stopped here" records where you left off and books the next session. PDFs are read in the browser with `pdfjs-dist`; the breakdown is plain rule-based text analysis, not an AI service, and is fully editable before anything is created. A plan is a goal (`goals.kind`, `goals.source_name`) whose pieces are flexible commitments (`goal_id`).
- **Main job.** `jobs.is_main` decides the hourly rate used by What if… and work-hours costs (`PATCH /jobs/{id}/main`). Migration `a7c3e9d5f216`.
- Number boxes no longer get stuck on 0 ("050").

### Calendar and planning updates
- **One day of a repeat.** Click a repeating event → *Edit just this day* (a half-day shift, say). The day is replaced by a one-off with the same title, planet and job; the rest of the repeat is untouched. Dragging the bottom handle of a repeating event does the same. *Edit every repeat* still changes the whole series. Fixed one-off events resize directly.
- **Time off.** `commitments.time_off` (migration `b8d4f1a6c327`) marks an all-day event as time off; it shows as a highlighted banner across those dates, with the columns tinted. Mid-semester breaks from Periods show as banners too. Fixed events that run a day or longer across midnight show as bars in both views, which keeps the month view tidy.
- **Rest hours** are editable (calendar → Change; default 8 am to 10 pm, saved per device in the browser). Suggested times, Study plans and "Use this time" stay inside them.
- **This week → Work waiting for time** suggests the nearest free sessions before the due day (max two hours each, two a day) with *Add it*; once fully planned an item leaves the list. Clash warnings now offer the nearest free gap in the next week with *Use this time*.
- **Notes → Schedule** turns a to-do into a flexible task (with a suggested booked time) or a fixed event, and ticks the note off.
- Orbit-line styles (*Soft* / *Even*) live under **+ Planets**.
