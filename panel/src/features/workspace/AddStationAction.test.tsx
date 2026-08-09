import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { components } from "../../shared/api/schema";
import i18n from "../../shared/i18n";
import { startMswServer } from "../../test/msw";
import { STAFF_KEY } from "../staff/hooks";
import { AddStationAction } from "./AddStationAction";

type StaffUser = components["schemas"]["User"];

function staffUser(id: string, email: string, role: StaffUser["role"]): StaffUser {
  return {
    id,
    tenant_id: "tenant-1",
    email,
    role,
    is_super_admin: false,
    has_qr_token: false,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
  };
}

let staffResponse: StaffUser[] = [];

function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AddStationAction eventId="evt-1" eventName="TechConf Moscow 2026" />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function selectStaff(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("combobox", { name: "Назначенный сотрудник" }));
  await user.click(screen.getByRole("option", { name: "staff@example.test · Сотрудник" }));
}

const server = startMswServer(
  http.get("http://api.test/api/events/:eventId/staff", () => HttpResponse.json(staffResponse)),
  http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
    await request.json();
    return HttpResponse.json({ token: "prov-tok-abc", expires_at: new Date(Date.now() + 600_000).toISOString() });
  }),
);

describe("AddStationAction", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    window.__ENV__ = { API_URL: "http://api.test" };
    staffResponse = [
      staffUser("admin-1", "owner@example.test", "admin"),
      staffUser("staff-1", "staff@example.test", "staff"),
      staffUser("manager-1", "manager@example.test", "manager"),
    ];
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("requires an explicit staff or manager selection and never offers an admin", async () => {
    const user = userEvent.setup();
    renderAction();

    const addStation = await screen.findByRole("button", { name: /Добавить станцию/ });
    expect(addStation).toBeDisabled();
    await user.click(await screen.findByRole("combobox", { name: "Назначенный сотрудник" }));
    expect(screen.queryByRole("option", { name: /owner@example\.test/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "staff@example.test · Сотрудник" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "manager@example.test · Менеджер" })).toBeInTheDocument();
  });

  it("does not auto-select the only eligible user", async () => {
    staffResponse = [staffUser("staff-1", "staff@example.test", "staff")];
    renderAction();

    expect(await screen.findByRole("combobox", { name: "Назначенный сотрудник" })).toHaveTextContent("Выберите сотрудника");
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled();
  });

  it("shows loading and keeps provisioning disabled before staff resolves", () => {
    renderAction();

    expect(screen.getByText("Загрузка назначенных сотрудников…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled();
  });

  it("shows an initial staff error distinct from the empty state", async () => {
    server.use(http.get("http://api.test/api/events/:eventId/staff", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    renderAction();

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить назначенных сотрудников.");
    expect(screen.queryByText("Для события нет доступных сотрудников или менеджеров.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled();
  });

  it("shows an empty state when only an ineligible admin is assigned", async () => {
    staffResponse = [staffUser("admin-1", "owner@example.test", "admin")];
    renderAction();

    expect(await screen.findByText("Для события нет доступных сотрудников или менеджеров.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled();
  });

  it("mints a provisioning token for the explicitly selected staff user and shows it as a QR with the returned expiry", async () => {
    let capturedBody: unknown;
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ token: "prov-tok-abc", expires_at: new Date(Date.now() + 600_000).toISOString() });
      }),
    );
    const user = userEvent.setup();
    renderAction();

    await selectStaff(user);
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));

    expect(await screen.findByRole("img", { name: "QR-код" })).toBeInTheDocument();
    expect(screen.getByText("TechConf Moscow 2026 · подключится как станция регистрации")).toBeInTheDocument();
    expect(capturedBody).toEqual({ staff_user_id: "staff-1" });
  });

  it("shows an inline error if minting fails", async () => {
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    const user = userEvent.setup();
    renderAction();

    await selectStaff(user);
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    expect(await screen.findByText("Не удалось создать код для подключения — попробуйте снова.")).toBeInTheDocument();
  });

  it("stays on the QR screen through a regenerate, without flashing back to the base button", async () => {
    let mintCallCount = 0;
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
        await request.json();
        mintCallCount += 1;
        return HttpResponse.json({
          token: mintCallCount === 1 ? "prov-tok-abc" : "prov-tok-xyz",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        });
      }),
    );
    const user = userEvent.setup();
    renderAction();

    await selectStaff(user);
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    await screen.findByTestId("qr-display-code");
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));

    expect(screen.queryByText("покажет QR")).not.toBeInTheDocument();
    await waitFor(() => expect(mintCallCount).toBe(2));
    expect(screen.getByTestId("qr-display-code")).toBeInTheDocument();
  });

  it("serializes regeneration and ignores its response after the QR session closes", async () => {
    let mintCallCount = 0;
    let releaseRegeneration!: () => void;
    const regenerationGate = new Promise<void>((resolve) => {
      releaseRegeneration = resolve;
    });
    server.use(
      http.post("http://api.test/api/events/:eventId/stations/provisioning-token", async ({ request }) => {
        await request.json();
        mintCallCount += 1;
        if (mintCallCount === 2) await regenerationGate;
        return HttpResponse.json({
          token: mintCallCount === 1 ? "prov-tok-abc" : "prov-tok-xyz",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        });
      }),
    );

    const user = userEvent.setup();
    renderAction();

    await selectStaff(user);
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    await screen.findByTestId("qr-display-code");

    const regenerate = screen.getByRole("button", { name: "Добавить станцию" });
    await user.click(regenerate);
    await waitFor(() => expect(mintCallCount).toBe(2));
    expect(regenerate).toBeDisabled();
    await user.click(regenerate);
    expect(mintCallCount).toBe(2);

    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    releaseRegeneration();

    const addStation = await screen.findByRole("button", { name: /Добавить станцию/ });
    await waitFor(() => expect(addStation).toBeEnabled());
    expect(screen.queryByTestId("qr-display-code")).not.toBeInTheDocument();
  });

  it("clears a selected user and disables base provisioning when their role becomes ineligible", async () => {
    const user = userEvent.setup();
    const queryClient = renderAction();

    await selectStaff(user);
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeEnabled();

    act(() => {
      queryClient.setQueryData(STAFF_KEY("evt-1"), [
        staffUser("staff-1", "staff@example.test", "admin"),
        staffUser("manager-1", "manager@example.test", "manager"),
      ]);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled());
    expect(screen.getByRole("combobox", { name: "Назначенный сотрудник" })).toHaveTextContent("Выберите сотрудника");
  });

  it("disables QR regeneration and remains fail-closed after an assigned user is removed", async () => {
    const user = userEvent.setup();
    const queryClient = renderAction();

    await selectStaff(user);
    await user.click(screen.getByRole("button", { name: /Добавить станцию/ }));
    await screen.findByTestId("qr-display-code");
    act(() => {
      queryClient.setQueryData(STAFF_KEY("evt-1"), [staffUser("manager-1", "manager@example.test", "manager")]);
    });
    const regenerate = screen.getByRole("button", { name: "Добавить станцию" });
    await waitFor(() => expect(regenerate).toBeDisabled());

    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeDisabled();
  });

  it("retains a selected eligible user after a failed background refresh", async () => {
    const user = userEvent.setup();
    const queryClient = renderAction();

    await selectStaff(user);
    server.use(http.get("http://api.test/api/events/:eventId/staff", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    await queryClient.invalidateQueries({ queryKey: STAFF_KEY("evt-1") });

    await waitFor(() => expect(queryClient.getQueryState(STAFF_KEY("evt-1"))?.status).toBe("error"));
    expect(screen.getByRole("combobox", { name: "Назначенный сотрудник" })).toHaveTextContent("staff@example.test");
    expect(screen.getByRole("button", { name: /Добавить станцию/ })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
