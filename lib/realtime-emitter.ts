import { getEnv } from "./env";

type RealtimeEventType = "message:new" | "message:read" | "message:deleted";

export async function emitRealtimeEvent(type: RealtimeEventType, payload: Record<string, unknown>) {
  const { appUrl, jwtSecret } = getEnv();

  const endpoint = `${appUrl.replace(/\/$/, "")}/internal/realtime`;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SOCKET_SECRET ?? jwtSecret,
      },
      body: JSON.stringify({ type, payload }),
      cache: "no-store",
    });
  } catch {
    // Non-blocking realtime best effort
  }
}
