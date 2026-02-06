import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useFavicon() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const updateFavicon = () => {
      const language = i18n.language;
      const faviconPath = language === 'ru' 
        ? '/idento-ru-letter.svg' 
        : '/idento-en-letter.svg';

      // Update main favicon
      let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        document.head.appendChild(link);
      }
      link.href = faviconPath;

      // Update apple-touch-icon
      let appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
      if (!appleLink) {
        appleLink = document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        document.head.appendChild(appleLink);
      }
      appleLink.href = faviconPath;
    };

    updateFavicon();

    // Listen for language changes
    i18n.on('languageChanged', updateFavicon);

    return () => {
      i18n.off('languageChanged', updateFavicon);
    };
  }, [i18n]);
}

