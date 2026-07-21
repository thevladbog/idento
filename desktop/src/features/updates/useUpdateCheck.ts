// TanStack Query wrapper for the update-check/install Tauri commands
// (Task 1). Using useQuery (not a bespoke effect/interval hook) means the
// SAME cached result is shared no matter how many pre-flight pages mount
// the update chip during one session -- each page unmounts/remounts its
// own PreflightShell as the operator navigates between the 5 pre-flight
// steps, so a naive per-component boot-effect would re-check on every
// single page transition. refetchInterval covers the "recheck daily"
// requirement; the initial fetch on first mount covers "check at boot".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getManifestUrlOverride } from "../../lib/updateConfig";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string | null;
}

async function invokeCheckForUpdate(): Promise<UpdateInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  const override = getManifestUrlOverride();
  return invoke<UpdateInfo>("check_for_update", { endpointOverride: override || null });
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ["update", "check"],
    queryFn: invokeCheckForUpdate,
    refetchInterval: CHECK_INTERVAL_MS,
    retry: false,
  });
}

export function useInstallUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["update", "check"] });
    },
  });
}
