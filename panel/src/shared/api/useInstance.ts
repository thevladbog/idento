import { useQuery } from "@tanstack/react-query";
import { getInstance } from "./client";

export function useInstance() {
  return useQuery({
    queryKey: ["instance"],
    queryFn: getInstance,
    staleTime: Infinity,
  });
}
