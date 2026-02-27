import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AUTH_COOKIE_NAME, signToken } from "@/lib/auth";
import { sanitizeAvatarUrl, sanitizeProfileText } from "@/lib/sanitize";
import { User } from "@/models/User";

export async function POST(request: Request) {
  await connectToDatabase();

  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await User.findOne({ email });

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  user.isOnline = true;
  user.lastSeen = new Date();
  await user.save();

  const token = signToken({ userId: user._id.toString(), email: user.email });

  const response = NextResponse.json({
    user: {
      id: user._id.toString(),
      email: user.email,
      displayName: sanitizeProfileText(String(user.displayName ?? "")),
      about: sanitizeProfileText(String(user.about ?? "")),
      avatarUrl: sanitizeAvatarUrl(String(user.avatarUrl ?? "")),
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
    },
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
