import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AUTH_COOKIE_NAME, getAuthUserFromCookies } from "@/lib/auth";
import { User } from "@/models/User";

export async function POST() {
  await connectToDatabase();

  const authUser = await getAuthUserFromCookies();

  if (authUser) {
    await User.findByIdAndUpdate(authUser.userId, {
      isOnline: false,
      lastSeen: new Date(),
    });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
