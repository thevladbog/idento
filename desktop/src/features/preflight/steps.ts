import { useTranslation } from "react-i18next";

export interface PreflightStepDef {
  label: string;
}

export function usePreflightSteps(): PreflightStepDef[] {
  const { t } = useTranslation();
  // Order matches the actual route flow, not just the conceptual "readiness"
  // grouping: station registration (part of the Equipment step) requires an
  // eventId, so Event necessarily comes before Equipment in practice.
  return [
    { label: t("preflightStepConnection") },
    { label: t("preflightStepLogin") },
    { label: t("preflightStepEvent") },
    { label: t("preflightStepEquipment") },
    { label: t("preflightStepMode") },
  ];
}
