// P4.2 Task 8 -- the live monitor's "Stations" card (board 7e,
// p4.2-board-7e-extract.md): one row per check-in station -- a colored dot
// (green = fresh, amber = stale) + name + running check-in count. The
// board extract explicitly flags amber as an overloaded token (it's ALSO
// the verdict-warning color for "not_registered" -- see RecentFeedCard.tsx)
// and calls out its own answer: a stale row ALSO carries a text duration
// label ("stale 40 s"), so staleness is never conveyed by color alone
// (WCAG 1.4.1, the same discipline VerdictCard.tsx's own comment
// establishes for verdict colors).
//
// `now` is NOT read internally (no second ticker/interval here) -- it's
// MonitorPage's own existing 1s ticker state, passed down so every
// stale-duration label in the card advances in lockstep with the header's
// "Updated Ns ago" label, off a single shared clock.
//
// PR #81 round-2 convergence Finding 5: the liveness dot itself is composed
// from `@idento/ui`'s `StatusPill` (`variant="bare"`) instead of being
// hand-rolled here -- panel/AGENTS.md's "UI primitives come only from
// @idento/ui" rule, the same discipline the header's own LIVE pill already
// follows (MonitorPage.tsx). The round-1 `indicator="dot"` API always
// renders a visible label next to the dot (its own WCAG 1.4.1 invariant),
// which doesn't fit this compact row -- `variant="bare"` was added to the
// primitive itself for exactly this shape rather than re-hand-rolling a dot
// a second time here.
//
// PR #81 round-3 convergence, UI Finding 4 (CodeRabbit): the round-2 shape
// above shipped with a fresh row rendering NO text at all next to its green
// dot -- a bare colored dot with no icon/text violates "never color alone"
// for a sighted colorblind user. This DELIBERATELY DEVIATES from board 7e's
// original "green/fresh shows no text at all" spec (p4.2-board-7e-extract.md
// itself flags amber as an overloaded color token elsewhere on this same
// card, so the board extract is not the final word on this card's color
// discipline) -- the codebase's codified never-color-alone rule governs. A
// fresh row now ALSO renders its own small VISIBLE muted status word (a NEW
// `monitorStationOnline` i18n key, kept separate from `monitorStationFresh`
// -- the dot's own accessible sr-only label -- so the two can diverge later
// without forcing a shared string), mirroring the stale row's pre-existing
// visible "stale Ns" span exactly: every row now conveys its liveness by
// TEXT, with color as a secondary reinforcing cue, never the sole channel.
import { Card, CardContent, CardHeader, CardTitle, StatusPill } from "@idento/ui";
import { useTranslation } from "react-i18next";
import type { components } from "../../shared/api/schema";
import { stationStaleness } from "./liveness";

type MonitorStationRow = components["schemas"]["MonitorStationRow"];

export interface StationsCardProps {
  stations: MonitorStationRow[];
  now: number;
}

export function StationsCard({ stations, now }: StationsCardProps) {
  const { t, i18n } = useTranslation();
  const numberFmt = new Intl.NumberFormat(i18n.language);

  return (
    <Card data-testid="monitor-stations-card">
      <CardHeader>
        <CardTitle>{t("monitorStationsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {stations.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("monitorStationsEmpty")}</p>
        ) : (
          stations.map((station) => {
            const staleness = stationStaleness(station.last_seen_at, now);
            // The dot's own accessible label -- exposed via StatusPill's
            // `variant="bare"` as real sr-only DOM text (PR #81 round-3
            // convergence, UI Finding 4 -- Codex facet: previously an
            // aria-label on a generic, non-focusable span). A stale row's
            // dot label reuses the EXACT same string as the
            // separately-rendered visible "stale Ns" span below (not a
            // second, potentially drifting copy of the same fact); a fresh
            // row's dot label is `monitorStationFresh`, distinct from the
            // NEW visible `monitorStationOnline` word below (Finding 4 --
            // CodeRabbit facet).
            const dotLabel = staleness.stale
              ? t("monitorStaleFor", { s: staleness.seconds })
              : t("monitorStationFresh");
            return (
              <div
                key={station.id}
                className="flex items-center gap-2 text-body"
                data-testid={`monitor-station-${station.id}`}
              >
                <span data-testid={`monitor-station-dot-${station.id}`}>
                  <StatusPill status={staleness.stale ? "in_progress" : "ready"} label={dotLabel} variant="bare" />
                </span>
                <span className="flex-1 truncate text-foreground">{station.name}</span>
                {staleness.stale ? (
                  <span
                    className="shrink-0 text-caption text-warning"
                    data-testid={`monitor-station-stale-${station.id}`}
                  >
                    {t("monitorStaleFor", { s: staleness.seconds })}
                  </span>
                ) : (
                  <span
                    className="shrink-0 text-caption text-muted-foreground"
                    data-testid={`monitor-station-online-${station.id}`}
                  >
                    {t("monitorStationOnline")}
                  </span>
                )}
                <span className="shrink-0 font-medium text-foreground">
                  {numberFmt.format(station.checkin_count)}
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
