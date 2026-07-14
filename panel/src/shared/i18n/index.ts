import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    debug: false,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
  });

// Keep <html lang> in sync with the active UI language — index.html only
// sets a static "en" default, so assistive tech and browser translation
// heuristics would otherwise keep treating the panel as English forever.
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
