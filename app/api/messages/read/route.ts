import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { requireAuth } from "@/lib/http";
import { emitRealtimeEvent } from "@/lib/realtime-emitter";
import { Message } from "@/models/Message";

export async function POST(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const body = await request.json();
  const conversationId = String(body.conversationId ?? "").trim();

  if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
    return NextResponse.json({ error: "Valid conversationId is required." }, { status: 400 });
  }

  const unreadMessages = await Message.find({
    conversationId: new Types.ObjectId(conversationId),
    recipientId: new Types.ObjectId(authUser.userId),
    readBy: { $ne: new Types.ObjectId(authUser.userId) },
    hiddenFor: { $ne: new Types.ObjectId(authUser.userId) },
  })
    .select({ _id: 1, senderId: 1 })
    .lean();

  if (unreadMessages.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const messageIds = unreadMessages.map((message) => message._id);

  await Message.updateMany(
    { _id: { $in: messageIds } },
    { $addToSet: { readBy: new Types.ObjectId(authUser.userId) } }
  );

  await emitRealtimeEvent("message:read", {
    conversationId,
    readerId: authUser.userId,
    messageIds: messageIds.map((id) => id.toString()),
  });

  return NextResponse.json({ updated: messageIds.length });
}
