import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';

type Props = {
  name: string;
  status?: string;
  planName?: string;
};

/**
 * Persistent tenant-identity strip pinned above every Tenant Detail
 * section, so the operator always knows whose account they're touching
 * (design brief's "wrong-tenant safety" requirement).
 */
export function TenantIdentityHeader({ name, status, planName }: Props) {
  return (
    <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-center gap-3 border-b border-border bg-background/95 px-8 py-4 backdrop-blur">
      <h1 className="text-xl font-bold">{name}</h1>
      <StatusBadge status={status} />
      {planName && <Badge variant="outline">{planName}</Badge>}
    </div>
  );
}
