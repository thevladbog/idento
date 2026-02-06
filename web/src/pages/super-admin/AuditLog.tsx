import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import api from '@/lib/api';

export default function AuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const response = await api.get('/api/super-admin/audit-log?limit=50');
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

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('timestamp')}</TableHead>
              <TableHead>{t('admin')}</TableHead>
              <TableHead>{t('action')}</TableHead>
              <TableHead>{t('targetType')}</TableHead>
              <TableHead>{t('targetId')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t('noLogsFound')}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: { id: string; created_at: string; admin_user_id: string; action: string; target_type: string; target_id: string }) => (
                <TableRow key={log.id}>
                  <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{log.admin_user_id}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell>{log.target_type}</TableCell>
                  <TableCell className="font-mono text-xs">{log.target_id}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

