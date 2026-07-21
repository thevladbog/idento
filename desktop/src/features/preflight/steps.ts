import { useTranslation } from "react-i18next";

export interface PreflightStepDef {
  label: string;
}

export function usePreflightSteps(): PreflightStepDef[] {
  const { t } = useTranslation();
  return [
    { label: t("preflightStepConnection") },
    { label: t("preflightStepLogin") },
    { label: t("preflightStepEquipment") },
    { label: t("preflightStepEvent") },
    { label: t("preflightStepMode") },
  ];
}
