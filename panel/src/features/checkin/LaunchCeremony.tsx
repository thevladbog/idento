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
  AgentStatus, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NumberInput, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, Skeleton, Switch,
} from "@idento/ui";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAgentPrinters } from "../../shared/agent/useAgentPrinters";
import { $api } from "../../shared/api/query";
import { useEventZones } from "../attendees/hooks";
import { TestPrintDialog } from "../badge/TestPrintDialog";
import { useBadgeTemplate } from "../badge/hooks";
import { parseTemplateDoc, resolveBadgeConfig, serializeTemplateDoc } from "../badge/templateTypes";
import { usePreviewAttendee } from "../badge/usePreviewAttendee";
import { useEventReadiness } from "../events/hooks";
import { zoneIdentity } from "../../shared/lib/zoneIdentity";
import { useCheckinSettings, useRegisterStation, useSaveCheckinSettings } from "./hooks";
import { DEFAULT_CHECKIN_SETTINGS, type CheckinSettings } from "./settingsTypes";

// Same getRouteApi-by-string-id rationale as StationPage.tsx -- avoids a
// circular import with app/router.tsx (which imports THIS component for
// the route's `component:` field).
const routeApi = getRouteApi("/_app/events/$eventId/checkin/launch");

const SCAN_INPUT_MODES: CheckinSettings["scan_input"][] = ["wedge", "scanner", "manual"];

const SCAN_INPUT_LABEL_KEYS: Record<CheckinSettings["scan_input"], string> = {
  wedge: "launchScanInputWedge",
  scanner: "launchScanInputScanner",
  manual: "launchScanInputManual",
};

// Radix's Select throws if any SelectItem has value="" -- the zone select's
// own "No zone" option used to be a native `<option value="">`. This
// sentinel stands in for it (same pattern as TestPrintDialog.tsx's
// PRINTER_NONE) and is mapped back to `""` at the onValueChange boundary, so
// `zoneId` is unchanged from before this migration.
const ZONE_NONE = "__none";

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
  // PR #77 bot-review round 3, Finding 1 -- tracks WHICH event's settings
  // this form was last seeded for (not just a plain "seeded at all, ever"
  // boolean). `app/router.tsx` registers this route the same way it
  // registers the badge editor's -- a param-only URL change (this event's
  // launch ceremony to a DIFFERENT event's) reuses the SAME LaunchCeremony
  // instance rather than remounting it, so a plain boolean ref would stay
  // `true` forever after the first event and silently never re-seed for any
  // event navigated to afterward. Same bug class, same fix shape as
  // BadgeEditorPage.tsx's own `initializedForEventId` (see that file's
  // comment) -- a plain ref (not reactive state) is enough here since
  // nothing outside the seeding effect itself needs to read this reactively
  // on the very next render (unlike BadgeEditorPage's Save-gating need).
  const settingsSeededForEventIdRef = React.useRef<string | null>(null);
  const [settingsSaved, setSettingsSaved] = React.useState(false);
  const savedTimeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(savedTimeoutRef.current), []);

  // Seed the editable form from the server's response exactly ONCE per
  // event it first resolves for -- a later background refetch of the SAME
  // event's settings (e.g. another operator's save) must never clobber
  // whatever this operator is mid-editing, but navigating to a DIFFERENT
  // event's ceremony must always re-seed from THAT event's real settings.
  React.useEffect(() => {
    if (settingsQuery.data && settingsSeededForEventIdRef.current !== eventId) {
      settingsSeededForEventIdRef.current = eventId;
      setSettingsForm(settingsQuery.data);
      setSettingsBaseline(settingsQuery.data);
    }
  }, [settingsQuery.data, eventId]);

  // PR #77 bot-review round, Finding N -- the SAME "ungated load effect" bug
  // class as P3.1's badge editor: `settingsForm`/`settingsBaseline` start
  // out as `DEFAULT_CHECKIN_SETTINGS` (hardcoded, not server-sourced) until
  // the seeding effect above fires. Previously nothing stopped the operator
  // from editing (and, since editing flips `settingsDirty` against a
  // baseline that's STILL the hardcoded default while the real GET is in
  // flight, saving) a whole-object PUT built on those defaults, clobbering
  // whatever the event's real saved settings actually were the instant they
  // would otherwise have arrived. Gated on `settingsQuery.isSuccess` --
  // `useCheckinSettings`' own `select: parseCheckinSettings` means `.data`
  // is truthy the moment `isSuccess` flips (never null), so this and the
  // seeding effect's own `settingsQuery.data` check become true in the same
  // render, with no window where one is true and the other isn't.
  const settingsReady = settingsQuery.isSuccess;

  function updateSetting<K extends keyof CheckinSettings>(key: K, value: CheckinSettings[K]) {
    if (!settingsReady) return;
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
    setSettingsSaved(false);
    saveSettings.reset();
  }

  const settingsDirty = JSON.stringify(settingsForm) !== JSON.stringify(settingsBaseline);

  function handleSaveSettings() {
    if (!settingsReady) return;
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
  // PR #77 bot-review round 2, Finding 4 -- `parsedDoc`'s own width_mm/
  // height_mm/dpi (parseTemplateDoc's EDITOR defaults, 90x55mm @ 300dpi) are
  // the right fallback for `doc.elements` above (there's no editor open
  // here, so this is only used for the elements array), but the WRONG
  // fallback for what TestPrintDialog actually validates a printer against:
  // the REAL check-in/reprint print path (usePrintBadge.printAttendee) uses
  // `resolveBadgeConfig`'s backend-parity 50x30mm @ 203dpi fallback for a
  // configless legacy template. Resolving it separately here (same raw
  // template, same shared function) means "Test badge" genuinely validates
  // what will actually print during check-in, not a different label size/
  // DPI that happens to also pass.
  const testPrintConfig = React.useMemo(() => resolveBadgeConfig(rawTemplate), [rawTemplate]);
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
  // PR #77 bot-review round 2, Finding 3 -- "Start check-in" registers the
  // station and immediately navigates to it, where StationPage fetches the
  // PERSISTED settings from the server -- an operator who just edited a
  // setting in THIS form (e.g. turned print_on_checkin off) without saving
  // yet would have that visible edit silently discarded, launching with
  // whatever's actually still saved. Reuses this file's own pre-existing
  // `settingsDirty`/`saveSettings.isPending` (the SAME dirty/pending
  // tracking the Save button below is already gated on -- no parallel
  // tracked value invented) rather than a new state. Judgment call: this
  // BLOCKS Start outright (as opposed to auto-saving on the operator's
  // behalf) -- the Save button is one click away and right next to it, and
  // silently saving-on-navigate would itself be a surprising side effect for
  // a CTA whose own label says nothing about saving.
  //
  // PR #77 bot-review round 3, Finding 6 -- `!settingsReady` closes a gap the
  // round 2 fix above left open: while `settingsQuery` is still loading (or
  // has failed), `settingsForm` AND `settingsBaseline` are BOTH still
  // `DEFAULT_CHECKIN_SETTINGS` (the seeding effect hasn't run yet), so
  // `settingsDirty` computes to `false` -- no difference detected -- and
  // Start check-in could previously be clicked with settings that were never
  // actually confirmed from the server. `settingsReady` is the same
  // `settingsQuery.isSuccess` flag every settings control in column 2 is
  // already gated on (see their own `disabled={!settingsReady}`), so this
  // adds no new tracked value, just extends the existing gate.
  const startDisabled =
    !ready ||
    !settingsReady ||
    trimmedStationName === "" ||
    registerStation.isPending ||
    settingsDirty ||
    saveSettings.isPending;

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
              <Select
                value={zoneId || ZONE_NONE}
                onValueChange={(next) => setZoneId(next === ZONE_NONE ? "" : next)}
              >
                <SelectTrigger id="launch-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ZONE_NONE}>{t("launchZoneNone")}</SelectItem>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="launch-col-settings">
          <CardHeader>
            <CardTitle>{t("launchColSettingsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* PR #77 bot-review round, Finding N -- every control below stays
                disabled until settingsQuery has actually resolved: editing a
                form still seeded from DEFAULT_CHECKIN_SETTINGS (not yet the
                event's real saved values) invites a whole-object Save that
                clobbers those real values the instant they'd otherwise
                arrive. `settingsQuery.isLoading` shows an explicit loading
                hint in place of a silently-inert form (an error state falls
                back to the SAME disabled controls -- the operator can't
                usefully seed real values here either, `settingsQuery.error`
                has no retry surfaced yet, so this stays simple rather than
                inventing a bespoke error+retry UI this task didn't ask for). */}
            {settingsQuery.isLoading ? (
              <p className="text-caption text-muted-foreground" data-testid="launch-settings-loading">
                {t("checkinSettingsLoading")}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="launch-print-on-checkin">{t("launchPrintOnCheckinLabel")}</Label>
              <Switch
                id="launch-print-on-checkin"
                disabled={!settingsReady}
                checked={settingsForm.print_on_checkin}
                onCheckedChange={(next) => updateSetting("print_on_checkin", next)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-dismiss-sec">{t("launchDismissSecLabel")}</Label>
              <NumberInput
                id="launch-dismiss-sec"
                min={1}
                max={30}
                disabled={!settingsReady}
                incrementLabel={t("commonIncrement")}
                decrementLabel={t("commonDecrement")}
                value={settingsForm.verdict_auto_dismiss_sec}
                // verdict_auto_dismiss_sec is a plain `number` (never ""),
                // matching the old Number(e.target.value) behavior where a
                // cleared/invalid field coerced to 0 (Number("") === 0)
                // rather than being ignored.
                onValueChange={(v) => updateSetting("verdict_auto_dismiss_sec", v === "" ? 0 : v)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="launch-scan-input">{t("launchScanInputLabel")}</Label>
              <Select
                disabled={!settingsReady}
                value={settingsForm.scan_input}
                onValueChange={(next) => updateSetting("scan_input", next as CheckinSettings["scan_input"])}
              >
                <SelectTrigger id="launch-scan-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_INPUT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(SCAN_INPUT_LABEL_KEYS[mode])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="launch-manual-search">{t("launchManualSearchLabel")}</Label>
              <Switch
                id="launch-manual-search"
                disabled={!settingsReady}
                checked={settingsForm.manual_search_enabled}
                onCheckedChange={(next) => updateSetting("manual_search_enabled", next)}
              />
            </div>
            {saveSettings.isError ? <p className="text-body text-destructive">{t("settingsSaveError")}</p> : null}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                disabled={!settingsReady || !settingsDirty || saveSettings.isPending}
                onClick={handleSaveSettings}
              >
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
        {/* PR #77 bot-review round 2, Finding 3 -- explains why Start is
            disabled even once `ready` is true: an unsaved settings edit (or
            a save still in flight) would otherwise be silently discarded by
            navigating to the station, which reads the PERSISTED settings. */}
        {ready && (settingsDirty || saveSettings.isPending) ? (
          <p className="text-caption text-muted-foreground" data-testid="launch-unsaved-settings-hint">
            {t("launchUnsavedSettingsHint")}
          </p>
        ) : null}
        <Button type="button" className="ml-auto" disabled={startDisabled} onClick={handleStart}>
          {t("launchStartCheckin")}
        </Button>
      </div>

      <TestPrintDialog
        open={testPrintOpen}
        onOpenChange={setTestPrintOpen}
        doc={serializeTemplateDoc(parsedDoc, rawTemplate)}
        config={testPrintConfig}
        previewData={preview.data}
        previewName={previewName}
        eventId={eventId}
      />
    </div>
  );
}
