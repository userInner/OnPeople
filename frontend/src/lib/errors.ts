export function errorMessage(error: unknown, fallback = "操作失败"): string {
  if (typeof error === "string") return error.trim() || fallback;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String(error.message).trim();
    if (message) return message;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}
