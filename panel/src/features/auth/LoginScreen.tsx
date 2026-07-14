import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label,
} from "@idento/ui";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { login } from "../../shared/api/client";
import { saveSession } from "../../shared/api/session";
import { useInstance } from "../../shared/api/useInstance";

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const instance = useInstance();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (auth) => {
      saveSession(auth);
      navigate({ to: "/" });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("loginTitle")}</CardTitle>
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
              <Label htmlFor="login-email">{t("loginEmailLabel")}</Label>
              <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">{t("loginPasswordLabel")}</Label>
              <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {mutation.isError ? (
              <p className="text-body text-destructive">{mutation.error.message}</p>
            ) : null}
            <Button type="submit" disabled={mutation.isPending}>
              {t("loginSubmit")}
            </Button>
          </form>
          {instance.data?.mode === "saas" ? (
            <p className="mt-4 text-caption text-muted-foreground">
              {t("loginCreateOrgPrompt")}{" "}
              <Link className="text-primary underline-offset-4 hover:underline" to="/register">
                {t("loginCreateOrgLink")}
              </Link>
            </p>
          ) : null}
          <p className="mt-2 text-caption">
            <Link className="text-primary underline-offset-4 hover:underline" to="/qr-login">
              {t("loginStaffLink")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
