# PR #83 (panel/p4.3-equipment-hub) — Go bot-round-1 fix report

Worktree: `.claude/worktrees/panel-p4.3-equipment-hub`, branch
`worktree-panel-p4.3-equipment-hub`, starting HEAD `d873cd6`.

Three bot-review findings on the agent + backend Go code, all verified
real by the controller. TDD red-first for the two backend findings (new
contract tests written and confirmed failing before the implementation
changed); Finding 1 has no red-first test (see its own section — the
failure mode is not observably testable on this repo's Go toolchain).

## Finding 1 — agent: `generateUUIDv4` no longer `log.Fatalf`s

**File:** `agent/main.go`

**Problem:** `generateUUIDv4()` called `log.Fatalf` (os.Exit) on a
`crypto/rand.Read` failure. It's reachable from `loadConfig`'s
MachineID-upgrade branch, which runs inside HTTP handlers (e.g.
`/printers`) while holding `configMu` — a transient RNG failure would
kill the whole agent process mid-event instead of failing one request.

**Fix:**
- `generateUUIDv4()` now returns `(string, error)` instead of Fatal-ing.
- `loadConfig`'s upgrade branch (`main.go` ~line 160) propagates the
  error through its own `(*AgentConfig, error)` return — no behavior
  change to `loadConfig`'s contract, since it already returned an error.
- `main()`'s startup path (~line 1147, the `machineIDJustGenerated`
  branch) still calls `log.Fatalf` on the returned error, at its own
  discretion — this is the one call site where dying at startup is
  correct (nothing to serve yet), mirroring `ensureAuthToken`'s existing
  Fatalf immediately above it.
- Every `loadConfig()` call site was checked (grepped all 12 call sites
  across `main.go`): they already either 500 on error (`/printers/default`,
  `/printers/add`, `/printers/remove`, `/scanners/add`, `/scanners/remove`)
  or degrade gracefully (`/printers`, which already treated a
  `loadConfig` error as "no network-printer metadata available" rather
  than failing the request — that pre-existing behavior is unchanged).
  No call site needed new error-handling code; the signature change was
  compile-clean everywhere except the two `generateUUIDv4()` call sites
  themselves.

**Important toolchain finding — the bug's practical severity is lower
than it looks, but the fix is still correct:** this repo's Go toolchain
(go.mod `go 1.25.4`, `toolchain go1.26.5`) has changed `crypto/rand.Read`'s
contract. Per `go doc crypto/rand.Read`:

> Read fills b with cryptographically secure random bytes. It never
> returns an error, and always fills b entirely. Read calls io.ReadFull
> on Reader and crashes the program irrecoverably if an error is
> returned. The default Reader uses operating system APIs that are
> documented to never return an error on all but legacy Linux systems.

I confirmed this empirically: I wrote a test that swapped
`crypto/rand.Reader` (the stdlib's own, pre-existing injection seam — no
new seam was added to `main.go`) for an always-failing `io.Reader`, and
`crypto/rand.Read` did NOT return the error to `generateUUIDv4` — it
called the Go runtime's `fatal()` directly, which is **not** recoverable
via `defer`/`recover` and crashed the entire `go test` binary rather than
failing one subtest. I removed that test (and the loadConfig-level
variant built on it) rather than ship a test that crashes CI's test run.

Net effect: on this toolchain, on all but "legacy Linux systems," a
`crypto/rand` failure crashes the process regardless of what
`generateUUIDv4` does with the error — the original `log.Fatalf` and the
new `return "", err` are behaviorally identical in that case. The fix
still matters for: (a) the documented legacy-Linux exception, where
`Read` genuinely can return a normal error without a runtime crash; (b)
defensive correctness / not coupling the application's error-handling
contract to one Go version's runtime crash behavior; (c) doing what the
finding asked. Per the finding's own instructions ("add an RNG-failure
path test only if the function's rand source is injectable... if not
injectable, cover the error propagation at the loadConfig level via
review of compile-time contract and say so in the report") — the source
*is* injectable (`crypto/rand.Reader`), but the failure path is not
*observably testable* in-process without crashing the test binary, so I
covered it via the compile-time contract review above instead:
`generateUUIDv4() (string, error)`'s error is checked at both of its two
call sites, `loadConfig` returns it up through its own already-error-
returning signature, and `main()`'s Fatalf is the sole remaining
process-exit path, scoped to startup only.

**Tests:**
- `TestGenerateUUIDv4_Shape` updated for the new two-return-value
  signature (unchanged behavior otherwise).
- `TestLoadConfig_MissingMachineID_GeneratesAndPersists` (pre-existing)
  continues to cover the success path end-to-end through `loadConfig`.
- No new RNG-failure test — see toolchain finding above.

## Finding 2 — backend: `PUT .../default-printer` field-presence bug

**File:** `backend/internal/handler/equipment.go`

**Problem:** `EquipmentDefaultPrinterRequest.DeviceID` was `*uuid.UUID`.
`json.Unmarshal` leaves a `*uuid.UUID` field `nil` both when the JSON key
is absent (`{}`) and when it's present with an explicit `null`
(`{"device_id":null}`) — these are indistinguishable through `c.Bind`.
An accidentally-omitted `device_id` field therefore silently cleared the
machine's default printer, identically to the documented clear-request.

**Fix:**
- New `equipmentDefaultPrinterWire` struct: `DeviceID json.RawMessage`.
  `json.RawMessage` is `nil` only when the key is absent — present
  `null` decodes to the 4-byte literal `[]byte("null")`, so presence and
  nullness are now distinguishable.
- New `decodeEquipmentDefaultPrinterDeviceID(io.Reader) (*uuid.UUID,
  error)`: decodes with `DisallowUnknownFields` (same idiom as
  `decodeStrictConfig`); key absent → `errors.New("device_id is
  required; send null to clear")`; literal `null` → `(nil, nil)` (clear);
  a JSON string → parsed as a uuid (`(&id, nil)` on success, error on a
  malformed uuid or wrong JSON type).
- `PutDefaultEquipmentPrinter` now calls this helper instead of
  `c.Bind`, and 400s with the helper's error message on any failure.

**openapi.yaml:** `EquipmentDefaultPrinterRequest` already had
`required: [device_id]` + `nullable: true` on the schema (pre-existing —
the schema was already documented correctly; the *handler* just didn't
enforce it). I added a sentence to that schema's description and to the
operation's `400` response description making the enforced-presence
behavior explicit, since it's now actually validated at runtime, not
just documented.

**Panel client regen:** the openapi.yaml edit is prose-only (no schema
shape change — `required`/`nullable`/property types were already
correct), but per house rule any openapi.yaml edit needs
`npm run generate:api -w panel` committed in the same commit. Ran it;
diff is 3 doc-comment lines in `panel/src/shared/api/schema.d.ts`
(verified via `git diff`), no type-shape drift. `npm run typecheck -w
panel` passes clean.

**Tests (new, contract-level, in
`openapi_contract_equipment_p4_test.go`):**
- `TestOpenAPIContract_PutDefaultEquipmentPrinter_MissingFieldIs400` —
  `{}` → 400, exact message `"device_id is required; send null to
  clear"`, store never called.
- `TestOpenAPIContract_PutDefaultEquipmentPrinter_MalformedUUIDIs400` —
  `{"device_id":"not-a-uuid"}` → 400, store never called.
- Existing `_200Set` / `_200Clear` / `_TargetMissing404` tests continue
  to pass unmodified (i.e. the documented clear behavior via explicit
  `null` is unchanged).

Confirmed red-first: before the fix, `_MissingFieldIs400` failed because
the store call happened (old `*uuid.UUID` bind treated `{}` as `nil` ==
clear); after the fix, all 5 contract tests in this group pass.

## Finding 3 — backend: cross-kind config keys leak through validation

**File:** `backend/internal/handler/equipment.go`

**Problem:** `printerConfigShape` (agent_name/ip/port/dpi) was shared by
both printer kinds, and `scannerConfigShape` (port_name/terminator) was
shared by both scanner kinds. `DisallowUnknownFields` only rejects keys
the *shared* struct doesn't know about — so a `usb_wedge` scanner config
could carry `port_name` (a `com`-only key), a `com` scanner could carry
`terminator` (a `usb_wedge`-only key), and a `system` printer could carry
`ip`/`port`/`dpi` (`network`-only keys). All decoded silently and were
stored verbatim, misleading anything reading the config back for
reconciliation.

**Fix:** replaced the two shared shapes with four per-kind shapes, each
with only the keys valid for that exact kind:
- `networkPrinterConfigShape`: `agent_name` (required, non-empty),
  `ip` (required, non-empty), `port` (required, 1–65535), `dpi`
  (optional).
- `systemPrinterConfigShape`: `agent_name` ONLY (required, non-empty).
- `comScannerConfigShape`: `port_name` ONLY (required, non-empty).
- `wedgeScannerConfigShape`: `terminator` ONLY (required, one of
  enter/tab/none).

`validateEquipmentDeviceConfig` now switches on `(class, kind)` instead
of just `class`, decoding into the matching shape — a cross-kind key is
now rejected at decode time as an unknown field (via the existing
`decodeStrictConfig` helper, unchanged), the same as any other typo'd
key. Verbatim raw-bytes storage of the config is unchanged — only the
validation gate tightened. The `default:` branches for unknown
kind-within-known-class remain marked unreachable (`validKindsByClass`
gates them before this function is ever called), matching the
pre-existing unreachable-class-default idiom.

**openapi.yaml:** `EquipmentDeviceCreateRequest`'s description
previously said "printer (either kind) requires non-empty agent_name
(dpi optional)" — now wrong, since `dpi` is network-only. Rewrote the
paragraph to state the per-kind allowed-key sets precisely and to call
out that a key valid for one kind but not another is now rejected the
same as a genuinely unknown key. (Panel regen for this same edit is
covered under Finding 2's regen note above — one `npm run generate:api
-w panel` run covered both openapi.yaml diffs.)

**Tests (new cases added to the existing
`TestOpenAPIContract_CreateEquipmentDevice_400` table):**
- `wedge scanner with com's port_name is rejected` —
  `{"terminator":"enter","port_name":"COM3"}` on kind=usb_wedge → 400.
- `com scanner with wedge's terminator is rejected` —
  `{"port_name":"COM3","terminator":"enter"}` on kind=com → 400.
- `system printer with network's ip is rejected` —
  `{"agent_name":"A","ip":"192.168.1.1"}` on kind=system → 400.

Confirmed red-first: all three failed before the fix (the store's create
function was reached, meaning validation let the cross-kind key through);
after the fix, all 12 cases in the table (9 pre-existing + 3 new) pass.

## Test evidence (final, all green)

```
agent:    go test -race ./...                          → 49 passed in 4 packages
agent:    golangci-lint run                             → No issues found
backend:  OPENAPI_COVERAGE=1 go test -race ./internal/handler/...
                                                          → 396 passed in 1 package
backend:  go test -race ./...                            → 603 passed in 15 packages
backend:  golangci-lint run                              → 1 pre-existing issue in
                                                            main.go (middleware.Logger,
                                                            staticcheck) — untouched by
                                                            this change; confirmed
                                                            present with these edits
                                                            stashed out too
panel:    npm run typecheck -w panel                     → clean (tsc -b, no output)
```

## Concerns / follow-ups

1. The one `golangci-lint` finding on `backend/main.go`
   (`e.Use(middleware.Logger())`, staticcheck) is pre-existing and
   unrelated to this PR's diff — confirmed present on the base commit
   with my changes stashed out. Left untouched (out of scope for these
   3 findings); flagging in case the controller wants it filed
   separately.
2. Finding 1's fix cannot be exercised by an in-process unit test on this
   Go toolchain (`crypto/rand.Read` crashes the runtime on a Reader
   failure rather than returning an error) — see the toolchain note
   above. If a future Go version relaxes that contract, or if this ever
   needs to run on the toolchain's documented "legacy Linux" exception
   path, the fix is what makes error handling correct there; it just
   isn't independently test-provable today without an injection seam
   added purely for the test, which the assignment said not to add.
