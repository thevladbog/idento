import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

const styles: Record<string, string> = {
  active: 'bg-primary text-primary-foreground',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  suspended: 'bg-amber-500 text-black',
  archived: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();
  const s = status || 'active';
  return (
    <Badge variant={styles[s] ? undefined : 'outline'} className={styles[s] ?? ''}>
      {t(`tenantStatus_${s}`, s)}
    </Badge>
  );
}
