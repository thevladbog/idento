import type { CSSProperties } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { queryClient } from "./queryClient";
import { router } from "./router";
import { ThemeProvider } from "../shared/theme/ThemeProvider";

const TOASTER_STYLE = {
  "--success-bg": "var(--success)",
  "--success-border": "var(--success)",
  "--success-text": "var(--success-foreground)",
} as CSSProperties;

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Mounted once at the app root so any feature can fire `toast(...)`
            (sonner) without its own provider — same convention as web/App.tsx's
            super-admin console. Added here (P6.3 T6) for AttendeeCard's undo-
            checkin toast; `richColors` matches web/'s usage. */}
        <Toaster position="top-right" richColors style={TOASTER_STYLE} />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
