import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { requireAuth } from "@/lib/http";
import { sanitizeAvatarUrl, sanitizeProfileText } from "@/lib/sanitize";
import { User } from "@/models/User";

export async function GET(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("query") ?? "").trim();

  const filters = query
    ? {
        _id: { $ne: authUser.userId },
        $or: [
          { displayName: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
        ],
      }
    : { _id: { $ne: authUser.userId } };

  const users = await User.find(filters)
    .sort({ isOnline: -1, displayName: 1 })
    .limit(50)
    .lean();

  return NextResponse.json({
    users: users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
      displayName: sanitizeProfileText(String(user.displayName ?? "")),
      about: sanitizeProfileText(String(user.about ?? "")),
      avatarUrl: sanitizeAvatarUrl(String(user.avatarUrl ?? "")),
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
    })),
  });
}
