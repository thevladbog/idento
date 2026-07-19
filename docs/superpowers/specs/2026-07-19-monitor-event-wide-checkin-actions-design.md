# Event-wide check-in actions (monitor metrics gap) — Design

Follow-up to P4.2 (PR #81, merged). A Codex review of PR #81 surfaced a
deliberately-deferred design gap; this spec resolves it. All decisions
below were user-approved during brainstorm (2026-07-19).

## 1. Problem

The monitor's `rate_per_min`, `peak`, and `recent` feed all aggregate
from `checkin_actions` (`pg_store_monitor.go`), but three write paths
flip `attendees.checkin_status` WITHOUT inserting `checkin_actions`
rows:

1. **Mobile offline batch** — `ApplyBatchCheckin`
   (`pg_store_batch.go`): guarded UPDATE on attendees +
   `batch_checkin_log` only.
2. **Legacy `PUT /api/attendees/{id}`** — `UpdateAttendeeHandler` →
   blind `UpdateAttendee`. **This is also the mobile app's ONLINE
   single-scan check-in path** (`AttendeeApiService.checkinAttendee`
   sends `PUT {"checkin_status": true}`), so the gap is not
   offline-only: for a mobile-first event, EVERY check-in is invisible
   to the action-derived metrics.
3. **`POST /api/sync` (SyncPush)** — raw `UpdateAttendee` overwrite
   (legacy WatermelonDB-era path; still a live route).

Result: a mobile-only event's monitor shows `checked_in` rising while
scans/min stays 0, peak stays null, and Last scans stays empty. Totals
and per-zone (via the unattributed bucket) are already correct.

## 2. Decision

**Option (a): write `checkin_actions` rows from all three paths**, with
symmetric `'undo'` rows for legacy/sync un-checks, and NO new
provenance column (`station_id IS NULL` already distinguishes
non-station rows). Options considered and rejected:

- **(b) UNION aggregation** (checkin_actions + batch_checkin_log +
  attendee-timestamp heuristics): disqualified on facts —
  `ApplyBatchCheckin` inserts the `batch_checkin_log` row for BOTH
  `Created` and `AlreadyCheckedIn` outcomes (the outcome is not
  stored), so counting log rows overcounts every duplicate-device
  scan; PUT/sync write no log at all, so the UNION still misses
  mobile's most common path; `batch_checkin_log.checked_in_at` is
  TIMESTAMP (no tz) vs the feed's TIMESTAMPTZ; and the recent feed
  would need synthetic rows with no action id. Permanent read-path
  complexity across four queries to avoid a small write-path fix.
- **(c) Label metrics station-scoped in the UI**: cheapest and honest,
  but leaves the monitor permanently blind for mobile-first tenants —
  exactly the dual-distribution audience.

### Contract change

`checkin_actions` shifts from "station-path audit feed" to **"all
registration check-in state changes"**. Non-station rows carry
`station_id = NULL`. This supersedes the P4.1 note that kept the feed
station-path-only. Panel undo/reprint audit semantics are unchanged;
the P4.1 station rail and the monitor's recent feed simply start
showing mobile/legacy scans with an empty zone (`RecentFeedCard`'s
`zoneNameFor` already returns null for a station-less row). Zone
entries (`kind=zone_entry`) remain excluded — they write
`zone_checkins`, which the monitor never reads.

## 3. Store layer

### 3.1 New insert variant

A new statement const + Store method:

```go
// created_at = COALESCE($6, now())
const checkinActionInsertAtSQL = `INSERT INTO checkin_actions
  (event_id, attendee_id, station_id, action, staff_user_id, created_at)
  VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))`

InsertCheckinActionAt(ctx, eventID, attendeeID uuid.UUID, action string,
  stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error
```

The existing `checkinActionInsertSQL` stays byte-for-byte untouched —
the P4.1 pgxmock contract and the station path's transaction-stable
`now()` equality (`checked_in_at == ca.created_at`) are unaffected.
`staffUserID` is a pointer here (column is nullable) so call sites
without a resolvable user pass NULL rather than a zero UUID.

### 3.2 Batch path (`ApplyBatchCheckin`)

When the `kind=checkin` guarded UPDATE wins (`RowsAffected == 1`, i.e.
outcome `BatchCheckinCreated`), insert a `'checkin'` row with
`station_id = NULL`, `staff_user_id = staffUserID`, and **`created_at
= item.At`** — exactly the value the guarded UPDATE wrote into
`checked_in_at`, so the monitor's current-period predicate
(`ca.created_at >= a.checked_in_at`) holds by equality with zero
clock dependence, mirroring the station path's transaction-stable
`now()` contract.

The guarded UPDATE + action insert are wrapped in **one short
transaction** (mirroring `CheckInAttendee`) so the feed row commits
atomically with the state change. The `batch_checkin_log` insert stays
OUTSIDE the transaction, exactly as today, with its own
`client_uuid` PK guarantee. The method's "intentionally NOT wrapped in
one cross-call transaction" doc comment is updated to scope the claim:
the log insert remains standalone; only the two writes that must be
atomic together share a tx.

No row is inserted for `BatchCheckinAlreadyCheckedIn`,
`BatchCheckinDuplicateClientUUID`, or `kind=zone_entry`.

**Clock-skew note**: `item.At` is device time and is already trusted
verbatim for `attendees.checked_in_at` (pre-existing behavior). A
future-skewed `item.At` can transiently inflate `rate_per_min` (the
COUNT is `created_at >= since`, which future stamps satisfy); a
past-stamped offline flush lands in its true historical minute bucket,
retroactively (and honestly) updating peak while correctly NOT
inflating the current 5-minute rate. Accepted, not "fixed" — clamping
the action stamp would break the equality contract above.

## 4. Handler layer

Both handlers insert AFTER their `UpdateAttendee` succeeds,
**log-don't-fail** (the state change is already committed; failing the
request would leave the client believing the write failed — same
semantics as these paths' PR #81 `publishCheckinEvent` calls). Both
gate on an exact before/after `CheckinStatus` compare against the
already-loaded existing attendee, so no-op re-PUTs / replays insert
nothing.

### 4.1 Legacy PUT (`UpdateAttendeeHandler`, attendees.go)

- `false → true`: insert `'checkin'` with `created_at =
  existingAttendee.CheckedInAt` as just persisted (the handler already
  computes it: client-supplied `req.CheckedInAt`, preserved prior
  value, or `time.Now()` — non-nil in this branch by construction).
- `true → false`: insert `'undo'` with `at = nil` (DEFAULT `now()` —
  `checked_in_at` is nulled; no predicate involvement).
- `staff_user_id` = the JWT user the handler already parses.

### 4.2 SyncPush (sync.go)

Same transition detection per updated attendee, comparing
`existingAttendee.CheckinStatus` (loaded for tenant verification)
against the incoming value:

- `false → true`: `'checkin'` with `created_at =
  attendee.CheckedInAt` (client value as persisted by
  `UpdateAttendee`); nil → pass nil (DEFAULT `now()`; the overview's
  defensive `checked_in_at IS NOT NULL` guard already treats such rows
  as unattributed).
- `true → false`: `'undo'`, `at = nil`.
- `event_id` = `existingAttendee.EventID` (the trusted,
  tenant-verified value, per the PR #81 publish-site precedent).
- `staff_user_id` = JWT user claims when parseable, else NULL.

The `Created` leg needs nothing: `CreateAttendee`'s INSERT omits
`checkin_status`, so attendees are never born checked-in server-side;
a client that flips them does so via the Updated leg, covered above.

`UpdateAttendeeInfo` (general info PATCH-style update) passes existing
check-in fields through unchanged — no transition, no row, no change
needed there.

## 5. What deliberately does NOT change

- **Zero query changes in `pg_store_monitor.go`.** `rate_per_min`,
  `peak`, and `recent` become event-wide automatically. NULL-station
  `'checkin'` rows fall through the attribution CTE's
  `checkin_stations` LEFT JOIN to `unattributed` — the same bucket
  those attendees occupy today via the "no action row" path — so
  **`sum(zones) + unattributed == checked_in` holds by construction,
  unchanged**. Symmetric `'undo'` rows only make `latest_state` more
  accurate; the Finding-A2 ordering and the round-3 current-period
  guard stay as-is and keep their integration fixtures green.
- **Stations card** stays station-scoped by definition (mobile devices
  are not `checkin_stations` and don't heartbeat).
- No migration. No API shape change. No panel/mobile/web code changes.
- `openapi.yaml` untouched unless plan-time review finds prose that the
  contract change makes false; if it IS edited (even prose-only),
  `npm run generate:api -w panel` must be run and committed (CI drift
  gate).
- Publish call sites: unchanged — PR #81 already publishes on exactly
  these transitions.

## 6. Testing

- **pgxmock (real SQL text, house convention):**
  - `ApplyBatchCheckin`: new expectations — tx begin, guarded UPDATE,
    action insert with `$6 = item.At`, commit, then log insert outside;
    `AlreadyCheckedIn` / duplicate / `zone_entry` insert NO action row.
  - `InsertCheckinActionAt`: statement-text test incl. NULL
    station/staff/at binds.
  - Handlers: legacy PUT writes `'checkin'` on false→true with the
    persisted timestamp, `'undo'` on true→false, nothing on no-op;
    SyncPush same per-attendee; insert failure does not fail the
    request (log-don't-fail).
- **Real-Postgres integration (TEST_DATABASE_URL-gated), extending
  `pg_store_monitor_integration_test.go`:** a batch-path check-in (a)
  appears in `CountRecentCheckins` and `GetMonitorMinuteBuckets` at
  `item.At`'s minute, (b) appears in `GetCheckinActions`, (c) lands in
  `unattributed`, and (d) the zones+unattributed==checked_in invariant
  stays green — including the existing A2/current-period fixtures,
  which must pass unmodified.
- Gates: backend test + lint; panel gates only if panel is touched
  (not expected).

## 7. Out of scope

- Backfill of historical mobile/legacy check-ins (pre-change rows
  remain absent from the feed; `unattributed` already covers them).
- A `source` provenance column (user-declined; `station_id IS NULL`
  suffices for every current need).
- Mobile client changes (its `device_number` provenance stays in
  `batch_checkin_log` / `attendees.checked_in_device_number`).
- Migrating mobile's online check-in off the legacy PUT (worth its own
  initiative; this spec makes the PUT path honest in the meantime).
