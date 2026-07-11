import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { groupAuditLogByDay, formatAuditDiff, type AuditLogEntry } from '@/lib/auditFormat';

const ACTION_BADGE_CLASS: Record<string, string> = {
  suspend_tenant: 'bg-amber-500 text-black',
  archive_tenant: 'bg-muted text-muted-foreground',
  reactivate_tenant: 'bg-primary text-primary-foreground',
  impersonate_tenant: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  impersonated_request: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
};

type Props = {
  entries: AuditLogEntry[];
  planNames?: Record<string, string>;
  emptyLabel: string;
};

export function AuditEntryList({ entries, planNames, emptyLabel }: Props) {
  const { i18n } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const groups = groupAuditLogByDay(entries);
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.day}>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {new Date(group.day).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })}
          </h4>
          <ul className="space-y-2">
            {group.entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                <Badge
                  className={ACTION_BADGE_CLASS[entry.action] ?? ''}
                  variant={ACTION_BADGE_CLASS[entry.action] ? undefined : 'outline'}
                >
                  {entry.action.replace(/_/g, ' ')}
                </Badge>
                <div className="flex-1">
                  <p>{formatAuditDiff(entry, planNames)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
