import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
  type Route,
} from "@playwright/test";
import {
  expectBearerAbsent,
  expectNoAxeViolations,
  expectNoBodyOverflow,
  expectTouchTargetsAtLeast44,
} from "./mobile-assertions";
import { installSession } from "./fixtures/e2eAuth";
import { seedMobileCompanion, type MobileSeed } from "./fixtures/seedMobileCompanion";

const ATTENDEE_LIST_RE = /\/api\/events\/[^/]+\/attendees(?:\?|$)/;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function isPostTo(response: Response, pathname: string): boolean {
  return response.request().method() === "POST" && new URL(response.url()).pathname === pathname;
}

function isGetTo(response: Response, pathname: string): boolean {
  return response.request().method() === "GET" && new URL(response.url()).pathname === pathname;
}

async function credentialFrom(
  response: Response,
  key: "token" | "qr_token",
  operation: string,
): Promise<string> {
  expect(response.ok(), `${operation} failed with status ${response.status()}`).toBe(true);
  const body = (await response.json()) as Partial<Record<"token" | "qr_token", unknown>>;
  const credential = body[key];
  expect(typeof credential, `${operation} did not return the credential field`).toBe("string");
  expect((credential as string).length, `${operation} returned an empty credential`).toBeGreaterThan(0);
  return credential as string;
}

async function checkpoint(page: Page, ready: Locator) {
  await expect(ready).toBeVisible();
  await expectNoBodyOverflow(page);
  await expectNoAxeViolations(page);
}

async function themeCheckpoint(page: Page, ready: Locator, theme: "light" | "dark") {
  await checkpoint(page, ready);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(theme === "dark");
}

async function expectFocusContained(page: Page, container: Locator) {
  const focusable = container.locator(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const count = await focusable.count();
  for (let index = 0; index < count + 2; index += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => container.evaluate((root) => root.contains(document.activeElement)))
      .toBe(true);
  }
}

function eventTabActions(page: Page): Locator {
  return page
    .getByRole("link", { name: /^(Overview|Attendees|Staff)$/ })
    .or(page.getByRole("link", { name: /^Monitor/ }))
    .or(page.getByRole("button", { name: "More" }));
}

async function expectQrSurface(page: Page) {
  const qr = page.getByRole("img", { name: "QR code" });
  await expect(qr).toBeVisible();
  await expect(qr.locator("xpath=ancestor::div[contains(@class, 'bg-white')][1]")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
}

async function submitOnceWhilePending(
  page: Page,
  urlPattern: string,
  confirm: Locator,
  settled: () => Promise<void>,
) {
  const release = deferred();
  let requestCount = 0;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    requestCount += 1;
    const response = await route.fetch();
    await release.promise;
    await route.fulfill({ response });
  };

  await page.route(urlPattern, handler);
  try {
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect.poll(() => requestCount).toBe(1);
    await confirm.evaluate((button: HTMLButtonElement) => button.click());
    expect(requestCount).toBe(1);
    release.resolve();
    await settled();
    expect(requestCount).toBe(1);
  } finally {
    release.resolve();
    await page.unroute(urlPattern, handler);
  }
}

function staffCard(page: Page, email: string): Locator {
  return page
    .getByText(email, { exact: true })
    .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' p-4 ')][1]");
}

async function qrRenderFingerprint(qr: Locator): Promise<string> {
  return qr.evaluate(async (node) => {
    const encoded = new TextEncoder().encode(node.innerHTML);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

async function expectQrRenderChanged(qr: Locator, previousFingerprint: string, timeout = 5_000) {
  await expect.poll(
    async () => (await qrRenderFingerprint(qr)) !== previousFingerprint,
    { message: "QR render must change after successful regeneration", timeout },
  ).toBe(true);
}

async function proveQrRenderSynchronizationNegativeControl(page: Page) {
  const sentinel = `non-secret-${crypto.randomUUID()}`;
  await page.setContent('<main><div data-testid="unchanged-qr"></div></main>');
  try {
    const unchangedQr = page.getByTestId("unchanged-qr");
    await unchangedQr.evaluate((node, value) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-marker", value);
      node.append(svg);
    }, sentinel);
    const fingerprint = await qrRenderFingerprint(unchangedQr);

    let failureMessage = "";
    try {
      await expectQrRenderChanged(unchangedQr, fingerprint, 100);
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain("QR render must change after successful regeneration");
    expect(failureMessage).not.toContain(sentinel);
    expect(failureMessage).not.toContain("<svg");
  } finally {
    await page.setContent("");
  }
}

async function proveBearerAbsenceNegativeControls(page: Page) {
  for (const source of ["alt", "title", "aria-labelledby", "value"] as const) {
    const sentinel = `non-secret-${crypto.randomUUID()}`;
    await page.setContent("<main></main>");
    await page.evaluate(({ kind, value }) => {
      const root = document.querySelector("main")!;
      if (kind === "alt") {
        const image = document.createElement("img");
        image.alt = value;
        root.append(image);
      } else if (kind === "title") {
        const target = document.createElement("button");
        target.title = value;
        root.append(target);
      } else if (kind === "aria-labelledby") {
        const target = document.createElement("button");
        target.setAttribute("aria-labelledby", "negative-control-label");
        const label = document.createElement("span");
        label.id = "negative-control-label";
        label.textContent = value;
        root.append(target, label);
      } else {
        const input = document.createElement("input");
        input.value = value;
        root.append(input);
      }
    }, { kind: source, value: sentinel });

    let rejected = false;
    try {
      await expectBearerAbsent(page, sentinel);
    } catch {
      rejected = true;
    }
    expect(rejected, `${source} bearer-detector negative control must reject`).toBe(true);
  }
  await page.setContent("");
}

async function mintStaffQr(page: Page, seed: MobileSeed): Promise<string> {
  const card = staffCard(page, seed.staff.email);
  await expect(card).toBeVisible();
  const generate = card.getByRole("button", { name: "Generate" });
  const responsePromise = page.waitForResponse((response) =>
    isPostTo(response, `/api/users/${seed.staff.id}/qr-token`),
  );

  if (await generate.isVisible()) {
    await expectTouchTargetsAtLeast44(generate);
    await generate.click();
  } else {
    const printCard = card.getByRole("button", { name: "Print card" });
    await expectTouchTargetsAtLeast44(printCard);
    await printCard.click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("heading", { name: "Regenerate QR code?" })).toBeVisible();
    await expectTouchTargetsAtLeast44(confirm.getByRole("button"));
    await confirm.getByRole("button", { name: "Print card" }).click();
  }

  const credential = await credentialFrom(await responsePromise, "qr_token", "staff QR mint");
  await expect(card.locator('[role="img"] svg')).toBeAttached();
  await expectTouchTargetsAtLeast44(card.getByRole("button"));
  return credential;
}

test.describe.serial("real-backend mobile companion acceptance", () => {
  test.setTimeout(240_000);

  test("light-theme functional journey", async ({ page, context }) => {
    await proveBearerAbsenceNegativeControls(page);
    await proveQrRenderSynchronizationNegativeControl(page);
    const seed = await seedMobileCompanion();
    await installSession(page, seed.adminSession, "light");

    await page.goto("/");
    const newEvent = page.getByRole("button", { name: "+ New event" });
    await checkpoint(page, newEvent);
    await newEvent.click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "New event" })).toBeVisible();
    await expectFocusContained(page, createDialog);
    await createDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(createDialog).toBeHidden();
    await expect(newEvent).toBeFocused();

    await page.goto(`/events/${seed.eventId}`);
    await checkpoint(page, page.getByRole("heading", { name: "Overview" }));
    const readinessScroller = page.getByTestId("readiness-strip-scroller");
    await readinessScroller.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(390);
    await expectNoBodyOverflow(page);
    await expectTouchTargetsAtLeast44(eventTabActions(page));

    const provisioningResponse = page.waitForResponse((response) =>
      isPostTo(response, `/api/events/${seed.eventId}/stations/provisioning-token`),
    );
    await page.getByRole("button", { name: /Add station/ }).click();
    const provisioningBearer = await credentialFrom(
      await provisioningResponse,
      "token",
      "station provisioning QR mint",
    );
    await expectQrSurface(page);
    await expectBearerAbsent(page, provisioningBearer);
    await checkpoint(page, page.getByRole("img", { name: "QR code" }));
    await expectTouchTargetsAtLeast44(page.getByRole("button", { name: /^(Close|Add station)$/ }));
    const renderedQr = page.getByTestId("qr-display-code");
    const previousQrFingerprint = await qrRenderFingerprint(renderedQr);
    const regeneratedResponse = page.waitForResponse((response) =>
      isPostTo(response, `/api/events/${seed.eventId}/stations/provisioning-token`),
    );
    await page.getByRole("button", { name: "Add station" }).click();
    const regeneratedBearer = await credentialFrom(
      await regeneratedResponse,
      "token",
      "station provisioning QR regenerate",
    );
    await expectQrRenderChanged(renderedQr, previousQrFingerprint);
    await expectBearerAbsent(page, regeneratedBearer);
    await page.getByRole("button", { name: "Close" }).click();

    await page.goto(`/events/${seed.eventId}/monitor`);
    const totalsCard = page.getByTestId("monitor-totals-card");
    await checkpoint(page, totalsCard);
    await expectTouchTargetsAtLeast44(eventTabActions(page));
    try {
      await context.setOffline(true);
      await expect(page.getByTestId("monitor-reconnecting-badge")).toBeVisible({ timeout: 15_000 });
      await expect(totalsCard).toBeVisible();
      await checkpoint(page, page.getByTestId("monitor-reconnecting-badge"));
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByTestId("monitor-live-pill")).toBeVisible({ timeout: 15_000 });
    test.info().annotations.push({
      type: "evidence-limit",
      description: "Browser network simulation only; not physical cellular or venue Wi-Fi evidence.",
    });

    await page.goto(`/events/${seed.eventId}/attendees`);
    const search = page.getByRole("searchbox", { name: "Search name, email, code…" });
    await checkpoint(page, search);
    const searchResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && ATTENDEE_LIST_RE.test(response.url())
      && new URL(response.url()).searchParams.get("search") === seed.attendeeCode,
    );
    // The backend matches each field independently, not a synthesized full
    // name. The seeded code is one exact searchable field; the UI row is
    // still verified by its complete display name below.
    await search.fill(seed.attendeeCode);
    await searchResponse;
    const availableRow = page.getByRole("button", { name: new RegExp(seed.availableAttendee.name) });
    await expect(availableRow).toBeVisible();
    await availableRow.click();
    await expect(page.getByText("Not checked in", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Check in manually/ }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Check in ${seed.availableAttendee.name}?` })).toBeVisible();
    await expectTouchTargetsAtLeast44(dialog.getByRole("button"));
    await submitOnceWhilePending(
      page,
      `**/api/events/${seed.eventId}/checkin`,
      dialog.getByRole("button", { name: "Check in" }),
      async () => expect(dialog).toBeHidden(),
    );
    await expect(page.getByText("Checked in", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Undo check-in" }).click();
    dialog = page.getByRole("dialog");
    await expectTouchTargetsAtLeast44(dialog.getByRole("button"));
    await submitOnceWhilePending(
      page,
      `**/api/events/${seed.eventId}/checkin/undo`,
      dialog.getByRole("button", { name: "Undo check-in" }),
      async () => expect(dialog).toBeHidden(),
    );
    await expect(page.getByText("Not checked in", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Block" }).click();
    dialog = page.getByRole("dialog");
    await expectTouchTargetsAtLeast44(dialog.getByRole("button"));
    await submitOnceWhilePending(
      page,
      `**/api/attendees/${seed.availableAttendee.id}/block`,
      dialog.getByRole("button", { name: "Block" }),
      async () => expect(dialog).toBeHidden(),
    );
    await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
    await submitOnceWhilePending(
      page,
      `**/api/attendees/${seed.availableAttendee.id}/unblock`,
      page.getByRole("button", { name: "Unblock" }),
      async () => expect(page.getByText("Not checked in", { exact: true })).toBeVisible(),
    );
    await expect(page.getByText("Not checked in", { exact: true })).toBeVisible();
    await checkpoint(page, page.getByText("Not checked in", { exact: true }));
    await expectTouchTargetsAtLeast44(page.getByRole("button", { name: /^(Back|Show attendee QR|Unblock|Block)/ }));

    await page.getByRole("button", { name: "Back" }).click();
    const attendeeFailureHandler = async (route: Route) => {
      if (route.request().method() === "GET") await route.abort("failed");
      else await route.continue();
    };
    await page.route(`**/api/events/${seed.eventId}/attendees**`, attendeeFailureHandler);
    try {
      await search.fill("request-failure-state");
      await expect(page.getByText("Couldn't load attendees.")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByText("No matches", { exact: true })).toHaveCount(0);
    } finally {
      await page.unroute(`**/api/events/${seed.eventId}/attendees**`, attendeeFailureHandler);
    }
    const attendeeRecovery = page.waitForResponse((response) =>
      response.request().method() === "GET" && ATTENDEE_LIST_RE.test(response.url()) && response.ok(),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await attendeeRecovery;
    await expect(page.getByText("No matches", { exact: true })).toBeVisible();
    await checkpoint(page, page.getByText("No matches", { exact: true }));

    await page.goto(`/events/${seed.eventId}/staff`);
    await checkpoint(page, page.getByRole("heading", { name: "Staff" }));
    const staffBearer = await mintStaffQr(page, seed);
    await expectBearerAbsent(page, staffBearer);
    const fullScreenTrigger = staffCard(page, seed.staff.email).getByRole("button", { name: "Show full screen" });
    await expectTouchTargetsAtLeast44(fullScreenTrigger);
    await fullScreenTrigger.click();
    const qrDialog = page.getByRole("dialog");
    await expectQrSurface(page);
    await expectBearerAbsent(page, staffBearer);
    await expectFocusContained(page, qrDialog);
    await checkpoint(page, qrDialog.getByRole("img", { name: "QR code" }));
    await expectTouchTargetsAtLeast44(qrDialog.getByRole("button"));
    await qrDialog.getByRole("button", { name: "Close" }).click();
    await expect(qrDialog).toBeHidden();
    await expect(fullScreenTrigger).toBeFocused();

    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.getByRole("dialog");
    await expectTouchTargetsAtLeast44(drawer.getByRole("link"));
    await drawer.getByRole("link", { name: "Organization" }).click();
    await checkpoint(page, page.getByTestId("organization-page"));
    await expect(page.getByLabel("Organization name")).toBeVisible();

    const staffPage = await context.newPage();
    try {
      await installSession(staffPage, seed.staffSession, "light");
      await staffPage.goto("/");
      await staffPage.getByRole("button", { name: "Menu" }).click();
      const staffDrawer = staffPage.getByRole("dialog");
      const myProfile = staffDrawer.getByRole("link", { name: "My profile" });
      await expect(myProfile).toBeVisible();
      await expectTouchTargetsAtLeast44(staffDrawer.getByRole("link"));
      await myProfile.click();
      const selfAction = staffPage.getByRole("button", { name: "Show my login QR" });
      await checkpoint(staffPage, selfAction);
      await expectTouchTargetsAtLeast44(selfAction);
      await expectTouchTargetsAtLeast44(staffPage.getByRole("button", { name: "Sign out" }));
      const selfResponse = staffPage.waitForResponse((response) =>
        isPostTo(response, `/api/users/${seed.staff.id}/qr-token`),
      );
      await selfAction.click();
      const selfBearer = await credentialFrom(await selfResponse, "qr_token", "staff self-service QR mint");
      await expectQrSurface(staffPage);
      await expectBearerAbsent(staffPage, selfBearer);
      await checkpoint(staffPage, staffPage.getByRole("img", { name: "QR code" }));
      await expectTouchTargetsAtLeast44(staffPage.getByRole("button", { name: /^(Close|Show my login QR)$/ }));
    } finally {
      await staffPage.close();
    }
  });

  test("light and dark parity across representative states", async ({ context }) => {
    const seed = await seedMobileCompanion();

    for (const theme of ["light", "dark"] as const) {
      const page = await context.newPage();
      try {
        await installSession(page, seed.adminSession, theme);

        await page.goto(`/events/${seed.eventId}`);
        await themeCheckpoint(page, page.getByTestId("readiness-strip"), theme);
        const readinessChip = page
          .getByTestId("readiness-strip-scroller")
          .locator(":scope > span")
          .filter({ has: page.getByText("Attendees", { exact: true }) });
        await expect(readinessChip).toBeVisible();
        await expect(readinessChip.locator("svg")).toBeVisible();
        await expect(readinessChip.getByText("Done", { exact: true })).toBeVisible();

        await page.goto(`/events/${seed.eventId}/monitor`);
        await themeCheckpoint(page, page.getByTestId("monitor-stations-card"), theme);
        const stationRow = page.getByTestId(`monitor-station-${seed.stationId}`);
        const stationStatus = stationRow.getByTestId(
          new RegExp(`^monitor-station-(?:online|stale)-${seed.stationId}$`),
        );
        await expect(stationRow).toBeVisible();
        await expect(stationRow.getByTestId(`monitor-station-dot-${seed.stationId}`)).toBeVisible();
        await expect(stationStatus).toBeVisible();
        await expect(stationStatus).toHaveText(/Online|stale \d+ s/);

        await page.goto(`/events/${seed.eventId}/attendees`);
        await themeCheckpoint(page, page.getByRole("heading", { name: "Attendees" }), theme);
        for (const [attendee, status] of [
          [seed.availableAttendee, "Not checked in"],
          [seed.checkedInAttendee, "Checked in"],
          [seed.blockedAttendee, "Blocked"],
        ] as const) {
          const row = page
            .getByRole("button")
            .filter({ has: page.getByText(attendee.name, { exact: true }) });
          const statusPill = row.locator("[data-status]");
          await expect(row).toBeVisible();
          await expect(statusPill.locator("svg")).toBeVisible();
          await expect(statusPill.getByText(status, { exact: true })).toBeVisible();
        }

        await page.goto(`/events/${seed.eventId}/staff`);
        await themeCheckpoint(page, page.getByRole("heading", { name: "Staff" }), theme);

        await page.goto(`/events/${seed.eventId}/attendees?attendee=${seed.availableAttendee.id}`);
        const attendeeQrAction = page.getByRole("button", { name: "Show attendee QR" });
        await expect(attendeeQrAction).toBeVisible();
        await attendeeQrAction.click();
        await expectQrSurface(page);
        await themeCheckpoint(page, page.getByRole("img", { name: "QR code" }), theme);
        await page.getByRole("button", { name: "Back" }).click();

        await page.goto(`/events/${seed.eventId}/staff`);
        await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
        const staffBearer = await mintStaffQr(page, seed);
        await expectBearerAbsent(page, staffBearer);
        const fullScreenTrigger = staffCard(page, seed.staff.email).getByRole("button", { name: "Show full screen" });
        await expectTouchTargetsAtLeast44(fullScreenTrigger);
        await fullScreenTrigger.click();
        await expectQrSurface(page);
        await expectBearerAbsent(page, staffBearer);
        await themeCheckpoint(page, page.getByRole("img", { name: "QR code" }), theme);

        await page.goto(`/events/${seed.eventId}/badge`);
        const gate = page.getByRole("heading", { level: 1, name: "Badge editor" });
        await themeCheckpoint(page, gate, theme);
        await expectTouchTargetsAtLeast44(page.getByRole("button", { name: "Copy link for desktop" }));
      } finally {
        await page.close();
      }
    }
  });

  test("Tier-1 and Tier-2 loading, empty, error, stale and recovery states stay truthful", async ({ page }) => {
    const seed = await seedMobileCompanion();
    await installSession(page, seed.adminSession, "light");

    const homeGate = deferred();
    let failHome = false;
    const homeHandler = async (route: Route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (failHome) {
        await route.abort("failed");
        return;
      }
      const response = await route.fetch();
      await homeGate.promise;
      await route.fulfill({ response });
    };
    await page.route("**/api/events", homeHandler);
    try {
      await page.goto("/");
      const homeSkeleton = page.locator(".animate-pulse").first();
      await checkpoint(page, homeSkeleton);
      homeGate.resolve();
      await checkpoint(page, page.getByRole("button", { name: "+ New event" }));
      failHome = true;
      await page.reload();
      await expect(page.getByText("Couldn't load your events.")).toBeVisible({ timeout: 20_000 });
      await checkpoint(page, page.getByText("Couldn't load your events."));
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByText("No events yet")).toHaveCount(0);
    } finally {
      homeGate.resolve();
      await page.unroute("**/api/events", homeHandler);
    }
    const homeRecovery = page.waitForResponse(
      (response) => isGetTo(response, "/api/events") && response.ok(),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await homeRecovery;
    await checkpoint(page, page.getByText(/^E2E Check-in /).first());

    const tenantGate = deferred();
    let tenantFailure = false;
    const tenantHandler = async (route: Route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (tenantFailure) {
        await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
        return;
      }
      const response = await route.fetch();
      await tenantGate.promise;
      await route.fulfill({ response });
    };
    await page.route("**/api/tenants/*", tenantHandler);
    try {
      await page.goto("/organization");
      const organizationPage = page.getByTestId("organization-page");
      await checkpoint(page, organizationPage.locator(".animate-pulse").first());
      tenantGate.resolve();
      await checkpoint(page, page.getByLabel("Organization name"));
      tenantFailure = true;
      await page.reload();
      await expect(page.getByText("Couldn't load settings.")).toBeVisible({ timeout: 20_000 });
      await checkpoint(page, page.getByText("Couldn't load settings."));
    } finally {
      tenantGate.resolve();
      await page.unroute("**/api/tenants/*", tenantHandler);
    }
    await page.reload();
    await checkpoint(page, page.getByLabel("Organization name"));

    await page.goto(`/events/${seed.eventId}/attendees?search=no-such-attendee-state`);
    await checkpoint(page, page.getByText("No matches", { exact: true }));
    const attendeeHandler = async (route: Route) => {
      if (route.request().method() === "GET") await route.abort("failed");
      else await route.continue();
    };
    await page.route(`**/api/events/${seed.eventId}/attendees**`, attendeeHandler);
    const search = page.getByRole("searchbox", { name: "Search name, email, code…" });
    try {
      await search.fill("separate-request-error-state");
      await expect(page.getByText("Couldn't load attendees.")).toBeVisible({ timeout: 20_000 });
      await checkpoint(page, page.getByText("Couldn't load attendees."));
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByText("No matches", { exact: true })).toHaveCount(0);
    } finally {
      await page.unroute(`**/api/events/${seed.eventId}/attendees**`, attendeeHandler);
    }
    const attendeeRecovery = page.waitForResponse((response) =>
      response.request().method() === "GET" && ATTENDEE_LIST_RE.test(response.url()) && response.ok(),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await attendeeRecovery;
    await checkpoint(page, page.getByText("No matches", { exact: true }));

    const monitorPattern = `**/api/events/${seed.eventId}/monitor`;
    const monitorFailureHandler = async (route: Route) => {
      if (route.request().method() === "GET") await route.abort("failed");
      else await route.continue();
    };
    await page.route(monitorPattern, monitorFailureHandler);
    try {
      await page.goto(`/events/${seed.eventId}/monitor`);
      const snapshotError = page.getByTestId("monitor-snapshot-error");
      await expect(snapshotError).toBeVisible({ timeout: 20_000 });
      await checkpoint(page, snapshotError);
      await expect(page.getByTestId("monitor-body")).not.toHaveClass(/opacity-60/);
    } finally {
      await page.unroute(monitorPattern, monitorFailureHandler);
    }

    await page.reload();
    const totals = page.getByTestId("monitor-totals-headline");
    await checkpoint(page, totals);
    const retainedTotals = await totals.innerText();
    const retainedTitle = await page.getByRole("heading", { level: 1 }).innerText();

    let failedMonitorRequests = 0;
    let failedStreamRequests = 0;
    const backgroundMonitorFailureHandler = async (route: Route) => {
      if (route.request().method() === "GET") {
        failedMonitorRequests += 1;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    };
    const monitorStreamPattern = `**/api/events/${seed.eventId}/monitor/stream`;
    const monitorStreamFailureHandler = async (route: Route) => {
      if (route.request().method() === "GET") {
        failedStreamRequests += 1;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    };
    await page.route(monitorPattern, backgroundMonitorFailureHandler);
    await page.route(monitorStreamPattern, monitorStreamFailureHandler);
    try {
      await page.getByRole("link", { name: "Overview" }).click();
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      await page.getByRole("link", { name: "Monitor" }).click();
      await expect.poll(() => failedMonitorRequests).toBeGreaterThan(0);
      await expect.poll(() => failedStreamRequests).toBeGreaterThan(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(retainedTitle);
      await expect(totals).toHaveText(retainedTotals);
      await expect(page.getByTestId("monitor-snapshot-error")).toHaveCount(0);
      await checkpoint(page, page.getByTestId("monitor-reconnecting-badge"));
    } finally {
      await page.unroute(monitorStreamPattern, monitorStreamFailureHandler);
      await page.unroute(monitorPattern, backgroundMonitorFailureHandler);
    }
    const monitorRecovery = page.waitForResponse(
      (response) => isGetTo(response, `/api/events/${seed.eventId}/monitor`) && response.ok(),
    );
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "Monitor" }).click();
    await monitorRecovery;
    await checkpoint(page, totals);
    await expect(page.getByTestId("monitor-live-pill")).toBeVisible({ timeout: 15_000 });
  });
});
