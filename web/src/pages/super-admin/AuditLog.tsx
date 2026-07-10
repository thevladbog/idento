import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

const KNOWN_ACTIONS = [
  'create_tenant',
  'suspend_tenant',
  'reactivate_tenant',
  'archive_tenant',
  'impersonate_tenant',
  'impersonated_request',
  'create_subscription',
  'update_subscription',
  'create_plan',
  'update_plan',
];

export default function AuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    loadLogs(actionFilter);
  }, [actionFilter]);

  const loadLogs = async (action: string) => {
    setLoading(true);
    try {
      const params = action === 'all' ? '?limit=50' : `?action=${action}&limit=50`;
      const response = await api.get(`/api/super-admin/audit-log${params}`);
      setLogs(response.data.logs || []);
    } catch (error) {
      console.error('Failed to load audit log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('auditLog')}</h1>
        <p className="text-muted-foreground">{t('adminActionsLog')}</p>
      </div>

      {/* Filter */}
      <div className="mb-6">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allActions')}</SelectItem>
            {KNOWN_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>{action}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('timestamp')}</TableHead>
              <TableHead>{t('admin')}</TableHead>
              <TableHead>{t('action')}</TableHead>
              <TableHead>{t('targetType')}</TableHead>
              <TableHead>{t('targetId')}</TableHead>
              <TableHead>{t('auditIpAddress')}</TableHead>
              <TableHead>{t('userAgent')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t('noLogsFound')}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: { id: string; created_at: string; admin_user_id: string; action: string; target_type: string; target_id: string; ip_address?: string | null; user_agent?: string | null }) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{log.admin_user_id}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell>{log.target_type}</TableCell>
                  <TableCell className="font-mono text-xs">{log.target_id}</TableCell>
                  <TableCell>{log.ip_address ?? '—'}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={log.user_agent ?? ''}>{log.user_agent ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

