import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Layout } from '@/components/Layout';
import { Calendar, Users, Settings, QrCode, Building2 } from 'lucide-react';

export default function Dashboard() {
  const { t } = useTranslation();

  const tiles = [
    {
      icon: <Calendar className="h-8 w-8" />,
      title: t('manageEvents'),
      description: t('manageEventsDesc'),
      link: '/events',
      buttonText: t('viewEvents'),
      variant: 'default' as const,
    },
    {
      icon: <QrCode className="h-8 w-8" />,
      title: t('launchCheckin'),
      description: t('launchCheckinDesc'),
      link: '/checkin',
      buttonText: t('launchCheckin'),
      variant: 'default' as const,
    },
    {
      icon: <Users className="h-8 w-8" />,
      title: t('users'),
      description: t('manageUsersDesc'),
      link: '/users',
      buttonText: t('manageUsers'),
      variant: 'default' as const,
    },
    {
      icon: <Settings className="h-8 w-8" />,
      title: t('equipment'),
      description: t('equipmentSettingsDesc'),
      link: '/equipment',
      buttonText: t('manage'),
      variant: 'default' as const,
    },
    {
      icon: <Building2 className="h-8 w-8" />,
      title: t('organizationSettings'),
      description: t('organizationSettingsDesc'),
      link: '/organization',
      buttonText: t('settings'),
      variant: 'default' as const,
    },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{t('dashboard')}</h1>
          <p className="text-muted-foreground">{t('welcome')}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile, index) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary/10 text-primary">
                    {tile.icon}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl">{tile.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="min-h-[48px]">
                  {tile.description}
                </CardDescription>
                <Button asChild variant={tile.variant} className="w-full">
                  <Link to={tile.link}>{tile.buttonText}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}

