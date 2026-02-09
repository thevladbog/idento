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
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageToggle } from '@/components/language-toggle';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { t, i18n } = useTranslation();
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

  const logoSrc = i18n.language === 'ru' ? '/idento-ru-letter.svg' : '/idento-en-letter.svg';
  const appVersion = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '';

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-background">
      {/* Left: form column */}
      <div className="flex flex-col justify-center px-4 py-8 lg:py-12 order-2 lg:order-1">
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <LanguageToggle />
          <ModeToggle />
        </div>
        <div className="w-full max-w-md mx-auto">
          <Card>
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

      {/* Right: branding column */}
      <div className="relative flex flex-col min-h-[12rem] lg:min-h-screen login-brand-bg order-1 lg:order-2">
        <div className="absolute inset-0 login-brand-pattern" aria-hidden />
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-12 lg:py-24 text-center text-white">
          <img
            src={logoSrc}
            alt={t('appName')}
            className="h-14 w-auto lg:h-20"
          />
          <p className="mt-5 text-xl font-semibold lg:text-2xl">
            {t('appName')}
          </p>
          <p className="mt-2 max-w-xs text-sm text-white/90 lg:text-base">
            {t('appDescription')}
          </p>
        </div>
        {appVersion && (
          <footer className="relative py-4 text-center text-sm text-white/70">
            v{appVersion}
          </footer>
        )}
      </div>
    </div>
  );
}
