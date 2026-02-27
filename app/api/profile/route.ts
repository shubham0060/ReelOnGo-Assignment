import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { requireAuth } from "@/lib/http";
import { sanitizeAvatarUrl, sanitizeProfileText } from "@/lib/sanitize";
import { User } from "@/models/User";

export async function PUT(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const body = await request.json();
  const displayName = sanitizeProfileText(String(body.displayName ?? ""));
  const about = sanitizeProfileText(String(body.about ?? ""));
  const avatarUrl = sanitizeAvatarUrl(String(body.avatarUrl ?? ""));

  if (!displayName) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }

  const user = await User.findByIdAndUpdate(
    authUser.userId,
    {
      displayName,
      about,
      avatarUrl,
      lastSeen: new Date(),
    },
    { new: true }
  );

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user._id.toString(),
      email: user.email,
      displayName: user.displayName,
      about: user.about,
      avatarUrl: user.avatarUrl,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
    },
  });
}
