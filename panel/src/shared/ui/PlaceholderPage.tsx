import { useTranslation } from "react-i18next";

export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-page-title">{t(titleKey)}</h1>
      <p className="text-body text-muted-foreground">{t("placeholderComingSoon")}</p>
    </div>
  );
}
