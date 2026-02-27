import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { requireAuth } from "@/lib/http";
import { sanitizeMessage } from "@/lib/sanitize";
import { getOrCreateConversation } from "@/lib/conversation";
import { emitRealtimeEvent } from "@/lib/realtime-emitter";
import { Message } from "@/models/Message";
import { Conversation } from "@/models/Conversation";
import { User } from "@/models/User";

export async function GET(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const { searchParams } = new URL(request.url);
  const userId = String(searchParams.get("userId") ?? "").trim();
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit") ?? 30), 100);

  if (!userId || !Types.ObjectId.isValid(userId)) {
    return NextResponse.json({ error: "Valid userId is required." }, { status: 400 });
  }

  const conversation = await getOrCreateConversation(authUser.userId, userId);

  const filter: Record<string, unknown> = {
    conversationId: conversation._id,
    hiddenFor: { $ne: new Types.ObjectId(authUser.userId) },
  };

  if (cursor) {
    filter.createdAt = { $lt: new Date(cursor) };
  }

  const messages = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json({
    conversationId: conversation._id.toString(),
    messages: messages.reverse().map((message) => ({
      id: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId.toString(),
      recipientId: message.recipientId.toString(),
      text: sanitizeMessage(String(message.text ?? "")),
      readBy: message.readBy.map((id: Types.ObjectId) => id.toString()),
      isDeletedForEveryone: Boolean(message.isDeletedForEveryone),
      deletedAt: message.deletedAt ?? null,
      createdAt: message.createdAt,
    })),
    nextCursor: messages.length === limit ? messages[messages.length - 1].createdAt : null,
  });
}

export async function POST(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const body = await request.json();
  const toUserId = String(body.toUserId ?? "").trim();
  const rawText = String(body.text ?? "");
  const text = sanitizeMessage(rawText).slice(0, 2000);

  if (!toUserId || !Types.ObjectId.isValid(toUserId)) {
    return NextResponse.json({ error: "Valid recipient is required." }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  const recipient = await User.findById(toUserId).lean();

  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }

  const conversation = await getOrCreateConversation(authUser.userId, toUserId);

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: new Types.ObjectId(authUser.userId),
    recipientId: new Types.ObjectId(toUserId),
    text,
    readBy: [new Types.ObjectId(authUser.userId)],
  });

  conversation.lastMessageText = text;
  conversation.lastMessageAt = new Date();
  await conversation.save();

  const payload = {
    id: message._id.toString(),
    conversationId: conversation._id.toString(),
    senderId: authUser.userId,
    recipientId: toUserId,
    text,
    readBy: [authUser.userId],
    isDeletedForEveryone: false,
    deletedAt: null,
    createdAt: message.createdAt,
  };

  await emitRealtimeEvent("message:new", {
    conversationId: payload.conversationId,
    messageId: payload.id,
    senderId: payload.senderId,
    recipientId: payload.recipientId,
    text: payload.text,
    createdAt: payload.createdAt.toISOString(),
  });

  return NextResponse.json({ message: payload });
}

export async function DELETE(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const body = await request.json();
  const messageId = String(body.messageId ?? "").trim();
  const mode = String(body.mode ?? "me").trim().toLowerCase();

  if (!messageId || !Types.ObjectId.isValid(messageId)) {
    return NextResponse.json({ error: "Valid messageId is required." }, { status: 400 });
  }

  if (mode !== "me" && mode !== "everyone") {
    return NextResponse.json({ error: "mode must be 'me' or 'everyone'." }, { status: 400 });
  }

  const message = await Message.findById(messageId);

  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const requesterId = new Types.ObjectId(authUser.userId);
  const isParticipant = message.senderId.equals(requesterId) || message.recipientId.equals(requesterId);

  if (!isParticipant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (mode === "everyone" && !message.senderId.equals(requesterId)) {
    return NextResponse.json({ error: "Only sender can delete for everyone." }, { status: 403 });
  }

  const conversationId = message.conversationId;
  const senderId = message.senderId.toString();
  const recipientId = message.recipientId.toString();

  if (mode === "me") {
    if (!message.hiddenFor.some((userId: Types.ObjectId) => userId.equals(requesterId))) {
      message.hiddenFor.push(requesterId);
      await message.save();
    }

    await emitRealtimeEvent("message:deleted", {
      conversationId: conversationId.toString(),
      messageId: message._id.toString(),
      mode: "me",
      targetUserId: authUser.userId,
    });

    return NextResponse.json({ success: true, messageId: message._id.toString(), mode: "me" });
  }

  message.isDeletedForEveryone = true;
  message.deletedAt = new Date();
  message.text = "";
  await message.save();

  const latestMessage = await Message.findOne({ conversationId }).sort({ createdAt: -1 }).lean();
  const conversation = await Conversation.findById(conversationId);

  if (conversation) {
    if (latestMessage) {
      conversation.lastMessageText = latestMessage.isDeletedForEveryone
        ? "This message was deleted"
        : latestMessage.text;
      conversation.lastMessageAt = latestMessage.createdAt;
    } else {
      conversation.lastMessageText = "";
      conversation.lastMessageAt = new Date();
    }

    await conversation.save();
  }

  await emitRealtimeEvent("message:deleted", {
    conversationId: conversationId.toString(),
    messageId: message._id.toString(),
    mode: "everyone",
    deletedAt: message.deletedAt.toISOString(),
    senderId,
    recipientId,
  });

  return NextResponse.json({ success: true, messageId: message._id.toString(), mode: "everyone" });
}
