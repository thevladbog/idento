import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import api from '@/lib/api';
import type { Tenant } from '@/types/index';
import { toast } from 'sonner';
import { Building2, Globe, Mail } from 'lucide-react';

type OrganizationFormValues = {
  name: string;
  website?: string;
  contact_email?: string;
};

export default function OrganizationSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<OrganizationFormValues>();

  useEffect(() => {
    loadTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const loadTenant = async () => {
    try {
      const currentTenant = JSON.parse(localStorage.getItem('current_tenant') || 'null');
      if (!currentTenant) {
        return;
      }

      const response = await api.get(`/api/tenants/${currentTenant.id}`);
      setTenant(response.data);
      reset({
        name: response.data.name,
        website: response.data.website || '',
        contact_email: response.data.contact_email || '',
      });
    } catch (error) {
      console.error('Failed to load tenant:', error);
      toast.error(t('error'), { description: t('failedToUpdateOrganization') });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: OrganizationFormValues) => {
    if (!tenant) return;

    try {
      const response = await api.put(`/api/tenants/${tenant.id}`, {
        name: data.name,
        website: data.website || null,
        contact_email: data.contact_email || null,
      });

      setTenant(response.data);
      
      // Update current_tenant in localStorage
      localStorage.setItem('current_tenant', JSON.stringify(response.data));

      toast.success(t('organizationUpdated'));
    } catch (error) {
      console.error('Failed to update tenant:', error);
      toast.error(t('error'), { description: t('failedToUpdateOrganization') });
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!tenant) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">{t('noEventSelected')}</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{t('organizationSettings')}</h1>
          <p className="text-muted-foreground">{t('organizationSettingsDesc')}</p>
        </div>

        <div className="grid gap-6 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>{t('basicInformation')}</CardTitle>
              <CardDescription>{t('basicInformationDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {t('organizationName')}
                  </Label>
                  <Input
                    id="name"
                    {...register('name')}
                    placeholder={t('organizationName')}
                    required
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="website" className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {t('organizationWebsite')}
                  </Label>
                  <Input
                    id="website"
                    type="url"
                    {...register('website')}
                    placeholder="https://example.com"
                  />
                  <p className="text-sm text-muted-foreground">{t('optional')}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact_email" className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {t('organizationContact')}
                  </Label>
                  <Input
                    id="contact_email"
                    type="email"
                    {...register('contact_email')}
                    placeholder="contact@example.com"
                  />
                  <p className="text-sm text-muted-foreground">{t('optional')}</p>
                </div>

                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t('saving') : t('updateOrganization')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('organizationInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('yourRole')}</p>
                  <p className="font-medium capitalize">{tenant.role || 'member'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('created_at')}</p>
                  <p className="font-medium">
                    {new Date(tenant.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}


