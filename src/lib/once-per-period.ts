// Shared "run this at most once per period" bookkeeping — extracted after
// three call sites (weekly-review.ts's weekly-review generation,
// companion-detection.ts's daily detection pass, companion-generation.ts's
// daily generation pass) each reinvented the identical shape: an in-memory
// Set guarding against StrictMode double-effects / concurrent calls within
// the same page load, plus a localStorage flag (via user-storage.ts's
// getUserLocalData/setUserLocalData) that survives reload and persists
// across sessions. "Period" is a caller-chosen string — a calendar day for
// the two daily passes, a week_start for the weekly review — this module
// has no opinion on what it means, only on remembering whether a given
// (keyBase, userId, period) triple has already been marked done.
import { getUserLocalData, setUserLocalData } from "@/lib/user-storage"

// One Set per keyBase, not one global Set, so unrelated call sites (a
// detection pass vs a generation pass) can't collide on the same session
// key even if a userId/period happened to match.
const sessionAttempts = new Map<string, Set<string>>()

function sessionSetFor(keyBase: string): Set<string> {
  let set = sessionAttempts.get(keyBase)
  if (!set) {
    set = new Set()
    sessionAttempts.set(keyBase, set)
  }
  return set
}

// True if `period` is already marked done for this user under this
// keyBase — either earlier this same session, or persisted from an earlier
// one. Read-only: does not itself mark anything.
export function isDoneThisPeriod(keyBase: string, userId: string, period: string): boolean {
  if (sessionSetFor(keyBase).has(`${userId}:${period}`)) return true
  return getUserLocalData<string>(keyBase, userId) === period
}

// Marks `period` done for this user: immediately for the rest of this
// session, and persisted so it survives reload/future sessions. Callers
// with more than one exit point that all count as "done" (weekly-review.ts:
// existing row found / a genuinely quiet week / freshly generated) call
// this from each of those points individually, same as before extraction —
// this module doesn't assume a single call site owns the decision.
export function markDoneThisPeriod(keyBase: string, userId: string, period: string): void {
  sessionSetFor(keyBase).add(`${userId}:${period}`)
  setUserLocalData(keyBase, userId, period)
}

// Convenience wrapper for the simpler shape both companion passes share:
// one async function, run at most once per period, nothing meaningful to
// return on a skip. Marks the session guard BEFORE awaiting (so a
// concurrent/StrictMode-doubled call sees it immediately) but only
// persists the flag AFTER `run` resolves — if `run` throws, the exception
// propagates past the persist step, so the period is NOT marked done and
// the next session retries. Not used by weekly-review.ts: its three
// different "done" exit points (including one that must still read the DB
// even when already checked) don't fit a single wrapped call.
export async function runOncePerPeriod<T>(
  keyBase: string,
  userId: string,
  period: string,
  run: () => Promise<T>
): Promise<T | null> {
  if (isDoneThisPeriod(keyBase, userId, period)) return null
  sessionSetFor(keyBase).add(`${userId}:${period}`)
  const result = await run()
  setUserLocalData(keyBase, userId, period)
  return result
}
