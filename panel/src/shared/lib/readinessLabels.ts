import type { components } from "../api/schema";

type ReadinessStep = components["schemas"]["ReadinessStep"];

// The readiness pipeline's step-label vocabulary — one i18n key per step
// key, shared by home (ReadinessCell) and workspace (rail, overview,
// strip). Cross-cutting per panel/AGENTS.md's feature-sliced layout, hence
// src/shared (moved here from features/home/ReadinessCell in P6.2 after
// PR #106 review).
export const STEP_LABEL_KEYS: Record<ReadinessStep["key"], string> = {
  attendees: "readinessStepAttendees",
  badge: "readinessStepBadge",
  zones: "readinessStepZones",
  staff: "readinessStepStaff",
  equipment: "readinessStepEquipment",
};
