// P4.1 Task 6 -- maps the check-in station's four outcomes onto the
// existing @idento/ui verdict vocabulary (VERDICTS/verdictClasses) rather
// than inventing new station-specific colors (plan global constraint:
// "Verdict rendering reuses @idento/ui verdictClasses" -- station outcomes
// map: checked_in -> allowed, already_checked_in -> already_checked_in,
// blocked -> no_access, not_found -> not_registered).
//
// The API's own CheckinOutcome (schema.d.ts) is deliberately narrower --
// "checked_in" | "already_checked_in" | "blocked" -- because "not_found" is
// a CLIENT-side outcome only: an unresolved scanned code never reaches
// POST /api/events/{event_id}/checkin at all (useCheckinFlow.ts's submitCode
// short-circuits to this outcome itself once the code lookup comes back
// empty). CheckinFlowOutcome is the superset useCheckinFlow actually resolves
// to, and the one this mapping is defined over.
import type { Verdict } from "@idento/ui";

export type CheckinFlowOutcome = "checked_in" | "already_checked_in" | "blocked" | "not_found";

const OUTCOME_TO_VERDICT: Record<CheckinFlowOutcome, Verdict> = {
  checked_in: "allowed",
  already_checked_in: "already_checked_in",
  blocked: "no_access",
  not_found: "not_registered",
};

export function outcomeToVerdict(outcome: CheckinFlowOutcome): Verdict {
  return OUTCOME_TO_VERDICT[outcome];
}
