import {
  Avatar, AvatarFallback, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@idento/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { switchTenant } from "../../shared/api/client";
import { getCurrentTenant, getTenants, updateCurrentTenant, updateToken } from "../../shared/api/session";

export function OrgSwitcher() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = React.useState(getCurrentTenant());
  const tenants = getTenants();

  const mutation = useMutation({
    mutationFn: (tenantId: string) => switchTenant(tenantId),
    onSuccess: (res) => {
      updateToken(res.token);
      updateCurrentTenant(res.current_tenant);
      setCurrent(res.current_tenant);
      queryClient.invalidateQueries();
    },
  });

  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <Avatar className="size-6">
            <AvatarFallback>{current.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          {current.name}
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{tenants.length} organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((tenant) => (
          <DropdownMenuItem key={tenant.id} onSelect={() => mutation.mutate(tenant.id)}>
            {tenant.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
