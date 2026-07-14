import { ApiError } from "./ApiError";

export function authErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "authErrorInvalidCredentials";
    if (error.status >= 500) return "authErrorServer";
  }
  return "authErrorGeneric";
}
