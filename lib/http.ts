import { NextResponse } from "next/server";
import { getAuthUserFromCookies } from "./auth";

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireAuth() {
  const authUser = await getAuthUserFromCookies();

  if (!authUser) {
    return { error: badRequest("Unauthorized", 401), authUser: null };
  }

  return { error: null, authUser };
}
