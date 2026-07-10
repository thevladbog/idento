import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { Plus, QrCode, Shield } from 'lucide-react';
import QRCode from 'qrcode';
import api from '@/lib/api';
import type { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layout } from '@/components/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const createUserSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(['manager', 'staff']),
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;

export default function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [qrDialogUser, setQrDialogUser] = useState<User | null>(null);
  const [qrToken, setQrToken] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Render the QR code locally in the browser. The qr_token is a passwordless
  // 30-day login credential, so it must never be sent to a third-party image
  // service (e.g. api.qrserver.com) — that would leak it via the URL. See
  // WEB-SEC-01.
  useEffect(() => {
    if (!qrToken) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrToken, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((error) => {
        console.error('Failed to render QR code', error);
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: 'staff' },
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get<User[]>('/api/users');
      setUsers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch users', error);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: CreateUserFormValues) => {
    try {
      await api.post('/api/users', data);
      setIsDialogOpen(false);
      reset();
      fetchUsers();
    } catch (error) {
      console.error('Failed to create user', error);
    }
  };

  const handleGenerateQR = async (user: User) => {
    try {
      const response = await api.post(`/api/users/${user.id}/qr-token`);
      setQrToken(response.data.qr_token);
      setQrDialogUser(user);
    } catch (error) {
      console.error('Failed to generate QR token', error);
    }
  };

  const getRoleBadge = (role: string) => {
    const styles = {
      admin: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      staff: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[role as keyof typeof styles] || ''}`}>
        {role.toUpperCase()}
      </span>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">{t('users')}</h1>
            <p className="text-muted-foreground">{t('manageUsersDesc')}</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> {t('createUser')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('createUser')}</DialogTitle>
                <DialogDescription>
                  {t('createUserDesc')}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="email" className="text-right">{t('email')}</Label>
                    <div className="col-span-3">
                      <Input id="email" type="email" {...register('email')} />
                      {errors.email && <p className="text-sm text-destructive mt-1">{errors.email.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="password" className="text-right">{t('password')}</Label>
                    <div className="col-span-3">
                      <Input id="password" type="password" {...register('password')} />
                      {errors.password && <p className="text-sm text-destructive mt-1">{errors.password.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="role" className="text-right">{t('role')}</Label>
                    <div className="col-span-3">
                      <Select onValueChange={(value: string) => setValue('role', value as 'manager' | 'staff')} defaultValue="staff">
                        <SelectTrigger>
                          <SelectValue placeholder={t('selectRole')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manager">{t('roleManager')}</SelectItem>
                          <SelectItem value="staff">{t('roleStaff')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {errors.role && <p className="text-sm text-destructive mt-1">{errors.role.message}</p>}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? t('creating') : t('create')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('email')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('qrAccess')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">
                    {t('noUsers')}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.qr_token ? (
                        <span className="text-green-600 text-sm flex items-center">
                          <Shield className="w-4 h-4 mr-1" /> {t('qrEnabled')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t('qrDisabled')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.role === 'staff' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleGenerateQR(user)}
                          title={t('generateQR')}
                        >
                          <QrCode className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* QR Token Dialog */}
        <Dialog
          open={!!qrDialogUser}
          onOpenChange={(open) => {
            if (!open) {
              // Drop the login credential from memory when the dialog closes
              // (setting qrToken clears qrDataUrl via the effect above).
              setQrDialogUser(null);
              setQrToken('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('qrAccessToken')}</DialogTitle>
              <DialogDescription>
                {t('qrAccessTokenDesc')} {qrDialogUser?.email}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="flex justify-center mb-4">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    className="w-64 h-64 border rounded"
                  />
                ) : (
                  <div className="w-64 h-64 border rounded flex items-center justify-center text-sm text-muted-foreground">
                    …
                  </div>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">{t('tokenValue')}:</p>
                <code className="text-xs bg-muted p-2 rounded block break-all">
                  {qrToken}
                </code>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setQrDialogUser(null)}>{t('close')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

