# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server
npm run build       # tsc -b (project references type check) + vite build
npm run typecheck   # tsc --noEmit only
npm run preview     # Preview production build
```

There is no test suite and no lint script configured in this repo. `npm run build` is the closest thing to CI — it will fail on type errors.

To regenerate `project-export.md` (a full-repo Markdown dump used to hand context to an LLM, excluding `node_modules`, `.env`, lockfiles, and binaries): `node export-project.cjs`.

## Architecture

**Anchor** is a mobile-first PWA (React 19 + Vite + TypeScript) for daily mood/intention tracking, deployed on Vercel with Supabase as the backend (Postgres + Auth). UI is shadcn/ui ("new-york" style, see [components.json](components.json)) on Tailwind v4.

### Data model & daily cycle

The whole app revolves around one row per user per day in a few Supabase tables (see [supabase/migrations/20260502121206_create_anchor_schema.sql](supabase/migrations/20260502121206_create_anchor_schema.sql)), all RLS-protected by `auth.uid() = user_id`:

- `daily_anchors` — three daily tasks (`future_task`, `mindbody_task`, `life_task`) each with a `*_completed` boolean, plus `daily_intention`. Unique on `(user_id, date)`.
- `mood_logs` — one mood per day (`great|okay|meh|low|stressed`). Unique on `(user_id, date)`.
- `check_ins` — evening reflection (`what_matters`, `what_avoiding`, `what_felt_real`, `evening_release`, `evening_mood`). Unique on `(user_id, date)`.
- `move_suggestions`, `ai_insights`, `profiles`.

Types for all of these live in [src/types/index.ts](src/types/index.ts) and should stay in sync with the migrations by hand (no codegen).

The home screen ([src/pages/home.tsx](src/pages/home.tsx)) drives a "Daily Cycle": **mood → anchors → check-in**. It has two local UI modes, not persisted server-side as a field but tracked in `localStorage` per user/day:
- `planning` — user fills in the three anchor tasks and sets an intention.
- `tracking` — anchors are locked in and get checked off through the day.

Locking day (`doLockDay`) stamps `anchor_locked_at_<userId>_<date>` in localStorage. A 3-hour time gate (`ANCHOR_LOCK_DELAY_MS` in [src/lib/utils.ts](src/lib/utils.ts)) then prevents checking anchors off immediately after locking (`canCheckAnchors`/`getTimeUntilAnchorCheck`) — this is intentional friction, not a bug.

### Offline-first pattern

[src/lib/offline-sync.ts](src/lib/offline-sync.ts) implements a simple write-through cache + queue:
- Every write path checks `isOnline()`; if online it upserts to Supabase directly, if offline it calls `addToSyncQueue()` (stored in `localStorage` under `anchor_sync_queue`).
- `setLocalData`/`getLocalData` mirror the day's data into `localStorage` (`anchor_<userId>_<date>`) as a read cache independent of the sync queue.
- `processSyncQueue()` is flushed on the `online` browser event and on every route change in [src/pages/app-layout.tsx](src/pages/app-layout.tsx).

When adding a new synced field/table, follow this same pattern (write local first, queue if offline, flush on reconnect) rather than introducing a new persistence mechanism.

### AI insights & companion message — three tiers

[src/lib/ai-service.ts](src/lib/ai-service.ts) is the active module (despite the similarly-named [src/lib/ai-insights.ts](src/lib/ai-insights.ts), which is dead code — not imported anywhere, kept for reference only):

1. **Local rule-based insights** (`generateLocalInsights`) — always computed client-side from the last 30 days of moods/anchors, no network call.
2. **AI insights** (`generateAiInsights`) — cached per ISO week in `localStorage` (`anchor_ai_insights_cache`). In dev (`import.meta.env.DEV`), calls the Groq API directly using `VITE_GROQ_API_KEY`. In prod, calls `/api/insights` (a Vercel Edge Function, [api/insights.ts](api/insights.ts)) so the real `GROQ_API_KEY` never reaches the client.
3. **Companion message** (`generateCompanionMessage`) — a one-line morning greeting generated the same dev/prod way, with hardcoded English/Swahili fallback strings if offline or the API fails.

`fetchInsightsWithFallback()` is the entry point pages should call — it merges local + cached/fresh AI insights and degrades gracefully offline. The Edge Function ([api/insights.ts](api/insights.ts)) duplicates the pattern-building and prompt logic from `ai-service.ts`'s dev path; if you change the insight prompt or the `buildPatternData` shape, update both places.

### i18n

English/Swahili via i18next ([src/lib/i18n.ts](src/lib/i18n.ts), [src/locales/en.json](src/locales/en.json), [src/locales/sw.json](src/locales/sw.json)). All user-facing strings go through `t()` — avoid hardcoding copy in components (some existing code, e.g. button labels in `home.tsx`, does not yet follow this and should not be copied as a pattern). [src/lib/checkin-questions.ts](src/lib/checkin-questions.ts) deterministically picks two nightly reflection questions per user/day/language from a fixed pool via a seeded shuffle (same seed ⇒ same questions for that user on that day).

### Routing & auth

[src/App.tsx](src/App.tsx) gates all routes on `useAuth()` (`src/lib/auth-context.tsx`), a Supabase-session-backed context provider. Authenticated routes are nested under `AppLayout` ([src/pages/app-layout.tsx](src/pages/app-layout.tsx)), which renders the bottom tab bar (Home/Patterns/Check-in/Move), an offline banner, and a floating Focus Mode button. `/reset-password` is intentionally reachable even when logged in (Supabase password-recovery flow requirement).

### Environment variables

Client-side (`VITE_` prefix, exposed to the browser): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GROQ_API_KEY` (dev-only fallback, see above). Server-side only (used by [api/insights.ts](api/insights.ts), must never get a `VITE_` prefix): `GROQ_API_KEY`.
