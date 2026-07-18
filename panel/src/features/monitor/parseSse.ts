// Pure, incremental Server-Sent Events frame parser. No fetch, no React —
// Task 6's useMonitorStream owns the fetch/ReadableStream plumbing and just
// feeds decoded text chunks into the function this returns.
//
// SSE frames are separated by a blank line ("\n\n"); a chunk boundary can
// land anywhere (mid-line, mid-frame, mid-separator), so this buffers
// everything it's been fed and only extracts+dispatches complete frames
// (i.e. up to and including a "\n\n" it has actually seen). Within a frame,
// "event:" sets the event name (defaulting to "message" per the SSE spec
// when a frame carries only "data:" lines — the backend's "update" frames
// always send an explicit "event:", but "hello" test fixtures and any
// data-only frame rely on this default), "data:" lines are collected and
// joined with "\n", and lines starting with ":" are comments (the backend's
// 25s ": ping\n\n" keep-alive) — ignored entirely, never producing a
// dispatch on their own.
export function createSseParser(onEvent: (evt: { event: string; data: string }) => void): (chunk: string) => void {
  let buffer = "";

  return (chunk: string) => {
    buffer += chunk;

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue; // comment line (e.g. ": ping") — ignored
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (dataLines.length > 0) {
        onEvent({ event, data: dataLines.join("\n") });
      }
    }
  };
}
