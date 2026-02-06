import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink, Maximize } from 'lucide-react';

export default function EventCheckin() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const openFullscreenCheckin = () => {
    navigate(`/checkin-fullscreen?event=${eventId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('checkin')}</h2>
        <p className="text-muted-foreground">{t('checkinOptionsDesc')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="cursor-pointer hover:bg-accent hover:border-primary/40 transition-all" onClick={openFullscreenCheckin}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Maximize className="h-5 w-5 text-primary" />
              {t('fullscreenCheckin')}
            </CardTitle>
            <CardDescription>{t('fullscreenCheckinDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('launch')}
            </Button>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t('quickCheckin')}
            </CardTitle>
            <CardDescription>{t('quickCheckinDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" disabled>
              {t('comingSoon')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

