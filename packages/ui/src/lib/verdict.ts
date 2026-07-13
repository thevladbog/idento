export const VERDICTS = ["allowed", "no_access", "not_registered", "already_checked_in"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Token-backed classes; repeat scans (already_checked_in) are the blue/info verdict — never an auto-reprint. */
export const verdictClasses: Record<Verdict, { text: string; bg: string; solidBg: string }> = {
  allowed: { text: "text-verdict-allowed", bg: "bg-verdict-allowed/10", solidBg: "bg-verdict-allowed" },
  no_access: { text: "text-verdict-no-access", bg: "bg-verdict-no-access/10", solidBg: "bg-verdict-no-access" },
  not_registered: { text: "text-verdict-not-registered", bg: "bg-verdict-not-registered/10", solidBg: "bg-verdict-not-registered" },
  already_checked_in: { text: "text-verdict-repeat", bg: "bg-verdict-repeat/10", solidBg: "bg-verdict-repeat" },
};
