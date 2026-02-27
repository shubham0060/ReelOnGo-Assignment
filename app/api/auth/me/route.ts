import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { getAuthUserFromCookies } from "@/lib/auth";
import { sanitizeAvatarUrl, sanitizeProfileText } from "@/lib/sanitize";
import { User } from "@/models/User";

export async function GET() {
  await connectToDatabase();

  const authUser = await getAuthUserFromCookies();

  if (!authUser) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const user = await User.findById(authUser.userId).lean();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
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
}
