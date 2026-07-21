// Maps the check-in station's outcomes onto @idento/ui's Verdict vocabulary
// (VERDICTS/verdictClasses) instead of inventing station-specific colors.
// "not_found" never reaches POST /checkin -- it's produced client-side when
// the code lookup (useCheckinFlow.ts's submitCode) comes back empty.
import type { Verdict } from "@idento/ui";
import type { CheckinOutcome } from "./types";

export type CheckinFlowOutcome = CheckinOutcome | "not_found";

const OUTCOME_TO_VERDICT: Record<CheckinFlowOutcome, Verdict> = {
  checked_in: "allowed",
  already_checked_in: "already_checked_in",
  blocked: "no_access",
  not_found: "not_registered",
};

export function outcomeToVerdict(outcome: CheckinFlowOutcome): Verdict {
  return OUTCOME_TO_VERDICT[outcome];
}
