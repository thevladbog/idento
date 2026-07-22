// TanStack Query wrapper for the update-check/install Tauri commands
// (Task 1). Using useQuery (not a bespoke effect/interval hook) means:
// - Sequential page remounts within CHECK_INTERVAL_MS (24h) read cached
//   result with no new IPC call, since data remains "fresh" via staleTime.
// - Background refetch via refetchInterval still fires ~every 24h while
//   at least one consumer is mounted, keeping the check current.
// Each pre-flight page unmounts/remounts its own PreflightShell as the
// operator navigates between the 5 pre-flight steps; with staleTime set,
// these transitions no longer re-invoke the check-for-update command.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getManifestUrlOverride } from "../../lib/updateConfig";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string | null;
}

async function invokeCheckForUpdate(override: string | null): Promise<UpdateInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<UpdateInfo>("check_for_update", { endpointOverride: override || null });
}

export function useUpdateCheck() {
  const override = getManifestUrlOverride();
  return useQuery({
    // The override is part of the cache key, not just an input to queryFn:
    // otherwise a stale ["update", "check"] result from the old endpoint
    // could keep serving for up to CHECK_INTERVAL_MS after the operator
    // changes the manifest mirror URL on the Mode pre-flight step.
    queryKey: ["update", "check", override],
    queryFn: () => invokeCheckForUpdate(override),
    staleTime: CHECK_INTERVAL_MS,
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
