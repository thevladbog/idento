import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label,
} from "@idento/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { register } from "../../shared/api/client";
import { saveSession } from "../../shared/api/session";

export function RegisterScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [orgName, setOrgName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const mutation = useMutation({
    mutationFn: () => register(orgName, email, password),
    onSuccess: (auth) => {
      saveSession(auth);
      navigate({ to: "/" });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("registerTitle")}</CardTitle>
          <p className="text-caption text-muted-foreground">{t("registerTrialNote")}</p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="register-org">{t("registerOrgNameLabel")}</Label>
              <Input id="register-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="register-email">{t("registerEmailLabel")}</Label>
              <Input id="register-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="register-password">{t("registerPasswordLabel")}</Label>
              <Input id="register-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {mutation.isError ? (
              <p className="text-body text-destructive">{mutation.error.message}</p>
            ) : null}
            <Button type="submit" disabled={mutation.isPending}>
              {t("registerSubmit")}
            </Button>
          </form>
          <p className="mt-4 text-caption text-muted-foreground">
            {t("registerSignInPrompt")}{" "}
            <a className="text-primary underline-offset-4 hover:underline" href="/login">
              {t("registerSignInLink")}
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
