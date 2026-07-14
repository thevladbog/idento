import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label,
} from "@idento/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { authErrorKey } from "../../shared/api/authErrorKey";
import { loginWithQr } from "../../shared/api/client";
import { saveSession } from "../../shared/api/session";

// Camera-based scanning is check-in-station infrastructure (P4) — this
// screen ships the manual-code-entry path only, exactly as shown on the
// board's "Enter code manually" affordance.
export function QrLoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = React.useState("");

  const mutation = useMutation({
    mutationKey: ["loginWithQr"],
    mutationFn: () => loginWithQr(code.trim()),
    onSuccess: (auth) => {
      saveSession({ ...auth, tenants: [], current_tenant: undefined });
      navigate({ to: "/" });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("qrLoginTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <p className="text-body text-muted-foreground">{t("qrLoginManualPrompt")}</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="qr-code">{t("qrLoginCodeLabel")}</Label>
              <Input id="qr-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            {mutation.isError ? (
              <p className="text-body text-destructive">{t(authErrorKey(mutation.error))}</p>
            ) : null}
            <Button type="submit" disabled={mutation.isPending}>
              {t("qrLoginSubmit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
