import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export type TenantOption = { id: string; name: string };

type Props = {
  tenants: TenantOption[];
  value: string;
  onChange: (id: string) => void;
};

export function TenantCombobox({ tenants, value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = tenants.find((tn) => tn.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={selected ? selected.name : t('auditLog_allTenants')}
          className="w-[220px] justify-between"
        >
          {selected ? selected.name : t('auditLog_allTenants')}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder={t('auditLog_tenantSearchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('auditLog_noTenantsFound')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                keywords={[t('auditLog_allTenants')]}
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === '' ? 'opacity-100' : 'opacity-0')} />
                {t('auditLog_allTenants')}
              </CommandItem>
              {tenants.map((tn) => (
                <CommandItem
                  key={tn.id}
                  value={tn.id}
                  keywords={[tn.name]}
                  onSelect={() => {
                    onChange(tn.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === tn.id ? 'opacity-100' : 'opacity-0')} />
                  {tn.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
