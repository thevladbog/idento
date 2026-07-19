// P4.3 Task 7 -- the equipment hub's agent identity card, board 5a
// (connected/legacy) and 5d (agent down). A state machine purely over
// `useAgentInfo`'s own result shape -- no data fetching of its own.
//
// State mapping onto @idento/ui's AgentStatus (3-state: connected/stale/
// disconnected):
// - "connected" ⇒ AgentStatus "connected", title reuses the existing
//   badgeAgentStatus* pill vocabulary (TestPrintDialog.tsx/
//   LaunchCeremony.tsx precedent -- panel/AGENTS.md: don't duplicate a
//   cross-surface i18n key, and there's no equipment-specific "Connected"
//   pill text in this task's key list), detail = the mono meta line
//   (base-url · vVERSION · hostname · uptime Hh Mm).
// - "connected_legacy" ⇒ same green pill (the agent IS reachable and
//   printing/scanning work), but `info` is null (GET /info 404 -- a
//   pre-P4.3 agent binary) so there is no version/hostname/uptime to show;
//   detail instead carries `equipmentAgentLegacyHint`.
// - "checking" ⇒ AgentStatus "stale" (useAgentPrinters.ts's own documented
//   checking->stale mapping convention).
// - "disconnected" ⇒ board 5d: a second stacked card with the numbered
//   "Start the agent" steps, a Retry button wired straight to
//   `agent.refetch`, and the static "auto-retry in 8 s" caption -- the
//   ACTUAL 8s auto-retry timer lives inside useAgentInfo's own
//   `refetchInterval`, this component only renders the caption describing
//   it (task-7-brief.md: "your AgentCard only renders the caption").
import { AgentStatus, Button, Card, CardContent, CardHeader, CardTitle } from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { UseAgentInfoResult } from "../../shared/agent/useAgentInfo";
import { getAgentBaseUrl } from "../../shared/api/http";

export interface AgentCardProps {
  agent: UseAgentInfoResult;
}

// Board 5a: "uptime 3 h 12 m" -- whole hours + whole minutes, no seconds
// (uptime is a slow-changing fact, not a ticking clock like MonitorPage's
// "Updated Ns ago").
function formatUptime(uptimeSeconds: number): string {
  const totalMinutes = Math.floor(uptimeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `uptime ${hours} h ${minutes} m`;
}

// Board shows "localhost:3000" -- no protocol -- for the agent's own
// base URL; getAgentBaseUrl() always carries one (http://), so it's
// stripped here purely for display.
function displayBaseUrl(): string {
  return getAgentBaseUrl().replace(/^https?:\/\//, "");
}

function downloadAgentUrl(): string {
  return window.__ENV__?.AGENT_DOWNLOAD_URL ?? "https://github.com/thevladbog/idento/releases";
}

export function AgentCard({ agent }: AgentCardProps) {
  const { t } = useTranslation();
  const { state, info, refetch } = agent;

  if (state === "disconnected") {
    return (
      <div className="flex flex-col gap-4" data-testid="equipment-agent-card">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-card-title text-foreground">{t("equipmentAgentDown")}</h2>
              <AgentStatus state="disconnected" title={t("badgeAgentStatusDisconnected")} detail={t("equipmentAgentDownHint")} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("equipmentStartAgent")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2 text-body">
              <li className="flex gap-2">
                <span className="font-mono text-muted-foreground">1</span>
                <span>{t("equipmentStartStep1")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-muted-foreground">2</span>
                <span>
                  {t("equipmentStartStep2")}{" "}
                  <a href={downloadAgentUrl()} className="text-primary underline underline-offset-2">
                    {t("equipmentDownloadAgent")}
                  </a>
                </span>
              </li>
            </ol>
            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => void refetch()}>
                {t("equipmentRetry")}
              </Button>
              <span className="font-mono text-caption text-muted-foreground">{t("equipmentAutoRetry")}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const agentStatusState = state === "checking" ? "stale" : "connected";
  const titleKey =
    state === "checking" ? "badgeAgentStatusChecking" : "badgeAgentStatusConnected";
  const cardTitle = t("equipmentAgentTitle");

  let detail: string;
  if (state === "connected" && info) {
    // Join only non-empty segments -- a blank hostname (or any other blank
    // field) must not leave a dangling "· ·" in the meta line.
    detail = [displayBaseUrl(), `v${info.version}`, info.hostname, formatUptime(info.uptime_seconds)]
      .filter(Boolean)
      .join(" · ");
  } else if (state === "connected_legacy") {
    detail = t("equipmentAgentLegacyHint");
  } else {
    detail = "";
  }

  return (
    <Card
      data-testid="equipment-agent-card"
      className={state === "connected" || state === "connected_legacy" ? "border-success/40 bg-success/5" : undefined}
    >
      <CardContent className="pt-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-card-title text-foreground">{cardTitle}</h2>
          <AgentStatus state={agentStatusState} title={t(titleKey)} detail={detail || undefined} />
        </div>
      </CardContent>
    </Card>
  );
}
