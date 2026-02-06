import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import api from '@/lib/api';
import type { Tenant } from '@/types/index';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';

export function OrganizationSwitcher() {
  const { t } = useTranslation();
  useNavigate(); // Reserved for future navigation after org switch
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTenants();
  }, []);

  const loadTenants = async () => {
    try {
      const response = await api.get('/api/tenants');
      setTenants(response.data);
      
      // Get current tenant from user data
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const currentTenantData = JSON.parse(localStorage.getItem('current_tenant') || 'null');
      
      if (currentTenantData) {
        setCurrentTenant(currentTenantData);
      } else {
        // Find tenant by user's tenant_id
        const tenant = response.data.find((t: Tenant) => t.id === user.tenant_id);
        if (tenant) {
          setCurrentTenant(tenant);
          localStorage.setItem('current_tenant', JSON.stringify(tenant));
        }
      }
    } catch (error) {
      console.error('Failed to load tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchTenant = async (tenant: Tenant) => {
    try {
      const response = await api.post('/api/auth/switch-tenant', {
        tenant_id: tenant.id,
      });

      // Update token
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('current_tenant', JSON.stringify(response.data.current_tenant));
      
      // Update current tenant
      setCurrentTenant(response.data.current_tenant);
      setOpen(false);

      // Show success message
      toast.success(t('switchedToOrganization', { name: tenant.name }));

      // Refresh the page to reload data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch tenant:', error);
      toast.error(t('failedToUpdateOrganization'));
    }
  };

  if (loading || !currentTenant) {
    return (
      <div className="w-[180px] h-5 bg-accent rounded animate-pulse" />
    );
  }

  if (tenants.length <= 1) {
    // Don't show switcher if user only has one organization
    return (
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Building2 className="h-3.5 w-3.5" />
        <span className="truncate max-w-[180px]">{currentTenant.name}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="h-auto py-0 px-1 hover:bg-accent font-medium text-sm"
        >
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">{currentTenant.name}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="end">
        <Command>
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup heading={t('myOrganizations')}>
              {tenants.map((tenant) => (
                <CommandItem
                  key={tenant.id}
                  value={tenant.id}
                  onSelect={() => switchTenant(tenant)}
                  className="cursor-pointer"
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      currentTenant?.id === tenant.id ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="truncate">{tenant.name}</span>
                    {tenant.role && (
                      <span className="text-xs text-muted-foreground">
                        {tenant.role}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}


