import type { CloudAccountState } from "../types";

export function isCloudAccountState(
  value: unknown,
): value is CloudAccountState {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Partial<CloudAccountState>;
  return (
    typeof account.signedIn === "boolean" &&
    typeof account.serviceUrl === "string" &&
    Array.isArray(account.models)
  );
}
