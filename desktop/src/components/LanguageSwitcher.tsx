import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const LANGUAGES = [
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language?.slice(0, 2) ?? "en";

  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-0.5">
      {LANGUAGES.map(({ code, label }) => (
        <Button
          key={code}
          variant={current === code ? "secondary" : "ghost"}
          size="sm"
          className="min-w-9 px-2 font-medium"
          onClick={() => i18n.changeLanguage(code)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
