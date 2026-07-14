import { setupServer } from "msw/node";
import type { RequestHandler } from "msw";
// Explicit import rather than relying on vitest's ambient globals: this file
// lives in src/test/ but isn't named *.test.ts, so tsconfig.app.json's
// test-file exclusion doesn't cover it — `npm run typecheck` (tsc -b) type-
// checks it against the app config, which has no vitest/globals types.
import { afterAll, afterEach, beforeAll } from "vitest";

// Opt-in MSW server for new tests. Call at the top of a describe file:
//   const server = startMswServer(...handlers)
// Handlers use absolute URLs against http://api.test (matching the
// window.__ENV__.API_URL the panel tests set in beforeEach).
export function startMswServer(...handlers: RequestHandler[]) {
  const server = setupServer(...handlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
