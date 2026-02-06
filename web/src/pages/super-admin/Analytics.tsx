import { useTranslation } from 'react-i18next';

export default function Analytics() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('analytics')}</h1>
        <p className="text-muted-foreground">{t('systemAnalytics')}</p>
      </div>

      <div className="border rounded-lg p-12 text-center">
        <p className="text-muted-foreground">{t('comingSoon')}</p>
      </div>
    </div>
  );
}

