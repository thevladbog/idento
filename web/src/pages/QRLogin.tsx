import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { QrCode, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageToggle } from '@/components/language-toggle';

export default function QRLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [qrToken, setQrToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleQRLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await axios.post('http://localhost:8008/auth/login-qr', {
        qr_token: qrToken.trim(),
      });

      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      // Redirect to checkin for staff
      navigate('/checkin');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      setError(msg || t('invalidQRToken'));
    } finally {
      setIsLoading(false);
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
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center mb-4">
              <QrCode className="h-12 w-12 text-primary" />
            </div>
            <CardTitle className="text-2xl text-center">{t('qrLogin')}</CardTitle>
            <CardDescription className="text-center">
              {t('qrLoginDesc')}
            </CardDescription>
          </CardHeader>
        <CardContent>
          <form onSubmit={handleQRLogin}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="qr-token">{t('qrToken')}</Label>
                <Input
                  id="qr-token"
                  type="text"
                  placeholder={t('enterQRToken')}
                  value={qrToken}
                  onChange={(e) => setQrToken(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              {error && (
                <div className="text-sm text-destructive">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                {t('login')}
              </Button>
            </div>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground text-center">
            {t('regularLogin')}?{' '}
            <Button variant="link" className="p-0" onClick={() => navigate('/login')}>
              {t('clickHere')}
            </Button>
          </div>
        </CardFooter>
        </Card>
      </div>
    </div>
  );
}

