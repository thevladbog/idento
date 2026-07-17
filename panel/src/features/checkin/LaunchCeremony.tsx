// P4.1 Task 11 -- the launch ceremony (board 2a). Reached from the
// workspace (EventWorkspaceLayout.tsx's header CTA, WorkspaceRail.tsx's
// pinned rail-bottom row) once the readiness rail shows enough green to be
// worth confirming, or before that -- the CTA lock is the ONLY gate, every
// other affordance here (settings, printer check) is usable regardless of
// `ready` so an operator can get everything dialed in ahead of time.
//
// Registered in app/router.tsx as `eventCheckinLaunchRoute`, a TOP-LEVEL
// protected route -- a SIBLING of `eventWorkspaceRoute` (mirrors Task 8's
// `eventCheckinRoute` registration exactly, per this task's own brief) --
// so this page renders WITHOUT the workspace rail shell, same as the
// station itself.
//
// Three columns (board 2a):
//  1. Confirm event & station -- event name, a station-name input (a
//     suggested default, freely editable), an optional zone picker.
//  2. Check-in settings -- Task 5's four `CheckinSettings` fields, editable
//     with a scoped PUT (GeneralCard's baseline/dirty/Save pattern -- see
//     that file's own comment -- adapted for a PUT-the-whole-object body
//     rather than a partial PATCH, since CheckinSettings has no optional
//     fields server-side).
//  3. Printer check -- the P3.2 agent connectivity status plus a "Test
//     badge" action. This REUSES TestPrintDialog verbatim (zero
//     print-generation logic duplicated, per this task's brief): the
//     event's SAVED badge template (`useBadgeTemplate`, not a live editor
//     doc -- there's no editor open here) is round-tripped through
//     `parseTemplateDoc`/`serializeTemplateDoc` into the exact `doc`/
//     `config` shape TestPrintDialog already expects, and the preview
//     data is `usePreviewAttendee`'s own real-first-attendee-or-
//     SAMPLE_PERSONA resolution -- the same "sample/preview attendee" the
//     badge editor's own test-print trigger uses, so a "Test badge" print
//     here NEVER bumps a real attendee's printed_count (TestPrintDialog's
//     own established rule: a test print isn't a badge going out the
//     door).
//
// "Start check-in": disabled while `!readiness.data?.ready` (frontend-only
// lock -- plan-time fact #8, no server gate). On click: registers the
// station (upsert by name -- Task 5's useRegisterStation), then navigates
// to the station with `?station=<id>`. Heartbeat is NOT started here --
// Task 12's `useHeartbeat` mounts on StationPage itself once it loads,
// per the design spec's own "heartbeat every 20s while the station PAGE is
// mounted" wording.
import * as React from "react";
import {
  AgentStatus, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton, Switch,
} from "@idento/ui";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { $api } from "../../shared/api/query";
import { useEventZones } from "../attendees/hooks";
import { TestPrintDialog } from "../badge/TestPrintDialog";
import { useBadgeTemplate } from "../badge/hooks";
import { parseTemplateDoc, serializeTemplateDoc } from "../badge/templateTypes";
import { usePreviewAttendee } from "../badge/usePreviewAttendee";
import { useEventReadiness } from "../events/hooks";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";
import { useCheckinSettings, useRegisterStation, useSaveCheckinSettings } from "./hooks";
import { DEFAULT_CHECKIN_SETTINGS, type CheckinSettings } from "./settingsTypes";

// Same getRouteApi-by-string-id rationale as StationPage.tsx -- avoids a
// circular import with app/router.tsx (which imports THIS component for
// the route's `component:` field).
const routeApi = getRouteApi("/_app/events/$eventId/checkin/launch");

// Native <select>, styled to match TestPrintDialog.tsx's/PropertiesPane.tsx's
// own SELECT_CLASSNAME (duplicated per-file on purpose -- see those files'
// own comments: there's no shared @idento/ui Select primitive yet).
const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-body text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const SCAN_INPUT_MODES: CheckinSettings["scan_input"][] = ["wedge", "scanner", "manual"];

const SCAN_INPUT_LABEL_KEYS: Record<CheckinSettings["scan_input"], string> = {
  wedge: "launchScanInputWedge",
  scanner: "launchScanInputScanner",
  manual: "launchScanInputManual",
};

export function LaunchCeremony() {
  const { t } = useTranslation();
  const { eventId } = routeApi.useParams();
  const navigate = useNavigate();

  const eventQuery = $api.useQuery("get", "/api/events/{id}", { params: { path: { id: eventId } } });
  const readiness = useEventReadiness(eventId);
  const zonesQuery = useEventZones(eventId);
  const settingsQuery = useCheckinSettings(eventId);
  const saveSettings = useSaveCheckinSettings(eventId);
  const registerStation = useRegisterStation(eventId);

  const ready = readiness.data?.ready === true;

  // --- Column 1: station name + zone -------------------------------------
  const [stationName, setStationName] = React.useState(() => t("launchStationNameDefault"));
  const [zoneId, setZoneId] = React.useState("");

  // --- Column 2: check-in settings (scoped PUT, GeneralCard's own
  // baseline/dirty/Save pattern) -------------------------------------------
  const [settingsForm, setSettingsForm] = React.useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);
  const [settingsBaseline, setSettingsBaseline] = React.useState<CheckinSettings>(DEFAULT_CHECKIN_SETTINGS);
  const settingsSeededRef = React.useRef(false);
  const [settingsSaved, setSettingsSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  // Seed the editable form from the server's response exactly ONCE it
  // first resolves -- a later background refetch (e.g. another operator's
  // save) must never clobber whatever this operator is mid-editing.
  React.useEffect(() => {
    if (settingsQuery.data && !settingsSeededRef.current) {
      settingsSeededRef.current = true;
      setSettingsForm(settingsQuery.data);
      setSettingsBaseline(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  function updateSetting<K extends keyof CheckinSettings>(key: K, value: CheckinSettings[K]) {
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
    setSettingsSaved(false);
    saveSettings.reset();
  }

  const settingsDirty = JSON.stringify(settingsForm) !== JSON.stringify(settingsBaseline);

  function handleSaveSettings() {
    const savedForm = settingsForm;
    saveSettings.mutate(
      { params: { path: { id: eventId } }, body: { settings: savedForm } },
      {
        onSuccess: () => {
          setSettingsBaseline(savedForm);
          setSettingsSaved(true);
          window.clearTimeout(savedTimeoutRef.current);
          savedTimeoutRef.current = window.setTimeout(() => setSettingsSaved(false), 2000);
        },
      },
    );
  }

  // --- Column 3: printer check + Test badge -------------------------------
  const agent = useAgentPrinters(true);
  const templateQuery = useBadgeTemplate(eventId);
  const preview = usePreviewAttendee(eventId);
  const [testPrintOpen, setTestPrintOpen] = React.useState(false);

  const rawTemplate = templateQuery.data?.template ?? null;
  const hasTemplate = rawTemplate !== null;
  const parsedDoc = React.useMemo(() => parseTemplateDoc(rawTemplate), [rawTemplate]);
  const previewName =
    preview.mode === "attendee" && preview.attendee
      ? `${preview.attendee.first_name} ${preview.attendee.last_name}`.trim()
      : t("badgePreviewSample");

  const agentStatusState = agent.state === "checking" ? "stale" : agent.state;
  const agentStatusTitleKey =
    agent.state === "connected"
      ? "badgeAgentStatusConnected"
      : agent.state === "checking"
        ? "badgeAgentStatusChecking"
        : "badgeAgentStatusDisconnected";

  const testBadgeDisabled = agent.state !== "connected" || agent.printers.length === 0 || !hasTemplate;

  // --- CTA: Start check-in -------------------------------------------------
  const trimmedStationName = stationName.trim();
  const startDisabled = !ready || trimmedStationName === "" || registerStation.isPending;

  function handleStart() {
    if (startDisabled) return;
    registerStation.mutate(
      {
        params: { path: { event_id: eventId } },
        body: { name: trimmedStationName, zone_id: zoneId || null },
      },
      {
        onSuccess: (data) => {
          void navigate({
            to: "/events/$eventId/checkin",
            params: { eventId },
            search: { station: data.station.id },
          });
        },
      },
    );
  }

  if (eventQuery.isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-6" data-testid="launch-ceremony">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6" data-testid="launch-ceremony">
        <p className="text-body text-destructive">{t("workspaceLoadError")}</p>
        <Button asChild variant="outline">
          <Link to="/">{t("workspaceBackHome")}</Link>
        </Button>
      </div>
    );
  }

  const event = eventQuery.data;
  const zones = (zonesQuery.data ?? []).map(zoneIdentity);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6" data-testid="launch-ceremony">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <h1 className="text-page-title">{t("workspaceLaunchCheckin")}</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-caption text-muted-foreground">{event.name}</span>
        <div className="ml-auto">
          <Button asChild variant="outline">
            <Link to="/events/$eventId" params={{ eventId }}>
              {t("checkinExit")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        <Card data-testid="launch-col-event">
          <CardHeader>
            <CardTitle>{t("launchColEventTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-station-name">{t("launchStationNameLabel")}</Label>
              <Input
                id="launch-station-name"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
              />
              {trimmedStationName === "" ? (
                <p className="text-caption text-destructive">{t("launchStationNameRequired")}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-zone">{t("launchZoneLabel")}</Label>
              <select
                id="launch-zone"
                className={SELECT_CLASSNAME}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                <option value="">{t("launchZoneNone")}</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="launch-col-settings">
          <CardHeader>
            <CardTitle>{t("launchColSettingsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="launch-print-on-checkin">{t("launchPrintOnCheckinLabel")}</Label>
              <Switch
                id="launch-print-on-checkin"
                checked={settingsForm.print_on_checkin}
                onCheckedChange={(next) => updateSetting("print_on_checkin", next)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-dismiss-sec">{t("launchDismissSecLabel")}</Label>
              <Input
                id="launch-dismiss-sec"
                type="number"
                min={1}
                max={30}
                value={settingsForm.verdict_auto_dismiss_sec}
                onChange={(e) => updateSetting("verdict_auto_dismiss_sec", Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-scan-input">{t("launchScanInputLabel")}</Label>
              <select
                id="launch-scan-input"
                className={SELECT_CLASSNAME}
                value={settingsForm.scan_input}
                onChange={(e) => updateSetting("scan_input", e.target.value as CheckinSettings["scan_input"])}
              >
                {SCAN_INPUT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(SCAN_INPUT_LABEL_KEYS[mode])}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="launch-manual-search">{t("launchManualSearchLabel")}</Label>
              <Switch
                id="launch-manual-search"
                checked={settingsForm.manual_search_enabled}
                onCheckedChange={(next) => updateSetting("manual_search_enabled", next)}
              />
            </div>
            {saveSettings.isError ? <p className="text-body text-destructive">{t("settingsSaveError")}</p> : null}
            <div className="flex items-center gap-3">
              <Button type="button" disabled={!settingsDirty || saveSettings.isPending} onClick={handleSaveSettings}>
                {t("settingsSave")}
              </Button>
              {settingsSaved ? <span className="text-caption text-muted-foreground">{t("settingsSaved")}</span> : null}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="launch-col-printer">
          <CardHeader>
            <CardTitle>{t("launchColPrinterTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <AgentStatus state={agentStatusState} title={t(agentStatusTitleKey)} />
            {!hasTemplate ? <p className="text-caption text-muted-foreground">{t("launchTestBadgeNoTemplate")}</p> : null}
            <Button type="button" variant="outline" disabled={testBadgeDisabled} onClick={() => setTestPrintOpen(true)}>
              {t("launchTestBadgeButton")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        {registerStation.isError ? <p className="text-body text-destructive">{t("launchRegisterError")}</p> : null}
        {!ready ? (
          <p className="text-caption text-muted-foreground">{t("workspaceUnlockHint")}</p>
        ) : null}
        <Button type="button" className="ml-auto" disabled={startDisabled} onClick={handleStart}>
          {t("launchStartCheckin")}
        </Button>
      </div>

      <TestPrintDialog
        open={testPrintOpen}
        onOpenChange={setTestPrintOpen}
        doc={serializeTemplateDoc(parsedDoc, rawTemplate)}
        config={parsedDoc}
        previewData={preview.data}
        previewName={previewName}
        eventId={eventId}
      />
    </div>
  );
}
