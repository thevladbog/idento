import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/api';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

interface User {
  id: string;
  email: string;
  role: string;
  is_super_admin: boolean;
  created_at: string;
}

export default function AllUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when page/search change
  }, [page, search]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/super-admin/users', {
        params: { page, page_size: pageSize, search },
      });
      setUsers(response.data.users || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);

  if (loading && users.length === 0) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('allUsers')}</h1>
        <p className="text-muted-foreground">
          {t('total')}: {total} {t('users').toLowerCase()}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('users')}</CardTitle>
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('searchByEmail')}
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('createdAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {user.is_super_admin && (
                      <Badge className="bg-primary">{t('superAdmin')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('page')} {page} {t('of')} {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                {t('next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

