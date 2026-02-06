import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageToggle } from '@/components/language-toggle';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      setError(null);
      const response = await api.post('/auth/login', data);
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      // Store tenants and current tenant
      if (response.data.tenants) {
        localStorage.setItem('tenants', JSON.stringify(response.data.tenants));
      }
      if (response.data.current_tenant) {
        localStorage.setItem('current_tenant', JSON.stringify(response.data.current_tenant));
      }
      
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(msg || 'Login failed');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <nav className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Logo linkTo="/login" />
          <div className="flex items-center gap-4">
            <LanguageToggle />
            <ModeToggle />
          </div>
        </div>
      </nav>
      
      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl text-center">{t('login')}</CardTitle>
            <CardDescription className="text-center">
              {t('welcome')}
            </CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('loading') : t('loginButton')}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 items-center">
             <p className="text-sm text-muted-foreground">
                {t('dontHaveAccount')} <Link to="/register" className="underline hover:text-primary">{t('register')}</Link>
             </p>
             <p className="text-sm text-muted-foreground">
                {t('staffLogin')}? <Link to="/qr-login" className="underline hover:text-primary">{t('qrLogin')}</Link>
             </p>
        </CardFooter>
        </Card>
      </div>
    </div>
  );
}

