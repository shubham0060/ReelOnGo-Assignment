import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AUTH_COOKIE_NAME, signToken } from "@/lib/auth";
import { sanitizeProfileText } from "@/lib/sanitize";
import { User } from "@/models/User";

export async function POST(request: Request) {
  await connectToDatabase();

  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = sanitizeProfileText(String(body.displayName ?? ""));

  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "Email, password, and display name are required." }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const existingUser = await User.findOne({ email });

  if (existingUser) {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    email,
    passwordHash,
    displayName,
    about: "Hey there! I am using Connect.",
    avatarUrl: "",
    isOnline: true,
    lastSeen: new Date(),
  });

  const token = signToken({ userId: user._id.toString(), email: user.email });

  const response = NextResponse.json({
    user: {
      id: user._id.toString(),
      email: user.email,
      displayName: user.displayName,
      about: user.about,
      avatarUrl: user.avatarUrl,
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
