import { request as playwrightRequest, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:8008";

function requiredEnv(name: "IDENTO_ADMIN_EMAIL" | "IDENTO_ADMIN_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for real-backend E2E`);
  return value;
}

export type E2ESession = {
  token: string;
  user: { id: string; email: string; role: string };
  tenants: Array<{ id: string; name: string }>;
  current_tenant?: { id: string; name: string };
};

export async function loginWithCredentials(email: string, password: string): Promise<E2ESession> {
  const api = await playwrightRequest.newContext({ baseURL: BACKEND_URL });
  try {
    const response = await api.post("/auth/login", { data: { email, password } });
    if (!response.ok()) throw new Error(`E2E login failed with status ${response.status()}`);
    return (await response.json()) as E2ESession;
  } finally {
    await api.dispose();
  }
}

export function loginAdmin(): Promise<E2ESession> {
  return loginWithCredentials(
    requiredEnv("IDENTO_ADMIN_EMAIL"),
    requiredEnv("IDENTO_ADMIN_PASSWORD"),
  );
}

export async function installSession(page: Page, session: E2ESession, theme: "light" | "dark") {
  await page.addInitScript(({ auth, selectedTheme }) => {
    localStorage.setItem("token", auth.token);
    localStorage.setItem("user", JSON.stringify(auth.user));
    localStorage.setItem("tenants", JSON.stringify(auth.tenants));
    const current = auth.current_tenant ?? auth.tenants[0];
    if (current) localStorage.setItem("current_tenant", JSON.stringify(current));
    localStorage.setItem("theme", selectedTheme);
  }, { auth: session, selectedTheme: theme });
}
