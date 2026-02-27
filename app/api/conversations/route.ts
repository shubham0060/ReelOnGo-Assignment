import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { requireAuth } from "@/lib/http";
import { Conversation } from "@/models/Conversation";
import { Message } from "@/models/Message";
import { User } from "@/models/User";
import { sanitizeAvatarUrl, sanitizeMessage, sanitizeProfileText } from "@/lib/sanitize";

export async function GET(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);
  const cursor = searchParams.get("cursor");
  const currentUserObjectId = new Types.ObjectId(authUser.userId);

  const filter: Record<string, unknown> = {
    participants: currentUserObjectId,
    hiddenFor: { $ne: currentUserObjectId },
  };

  if (cursor) {
    filter.lastMessageAt = { $lt: new Date(cursor) };
  }

  const conversations = await Conversation.find(filter)
    .sort({ lastMessageAt: -1 })
    .limit(limit)
    .lean();

  const otherUserIds = conversations.map((conversation) => {
    const otherParticipantId = conversation.participants.find(
      (participant: Types.ObjectId) => participant.toString() !== authUser.userId
    );

    return otherParticipantId?.toString();
  });

  const uniqueOtherUserIds = [...new Set(otherUserIds.filter(Boolean))] as string[];

  const users = await User.find({ _id: { $in: uniqueOtherUserIds } }).lean();

  const usersMap = new Map(users.map((user) => [user._id.toString(), user]));
  const latestVisibleMessages = await Promise.all(
    conversations.map((conversation) =>
      Message.findOne({
        conversationId: conversation._id,
        hiddenFor: { $ne: currentUserObjectId },
      })
        .sort({ createdAt: -1 })
        .lean()
    )
  );

  const latestVisibleMessagesMap = new Map(
    conversations.map((conversation, index) => [conversation._id.toString(), latestVisibleMessages[index]])
  );

  const items = conversations
    .map((conversation) => {
      const otherParticipantId = conversation.participants.find(
        (participant: Types.ObjectId) => participant.toString() !== authUser.userId
      );

      if (!otherParticipantId) {
        return null;
      }

      const otherUser = usersMap.get(otherParticipantId.toString());

      if (!otherUser) {
        return null;
      }

      const latestVisibleMessage = latestVisibleMessagesMap.get(conversation._id.toString());
      const previewText = latestVisibleMessage
        ? latestVisibleMessage.isDeletedForEveryone
          ? "This message was deleted"
          : sanitizeMessage(String(latestVisibleMessage.text ?? ""))
        : "";
      const previewAt = latestVisibleMessage?.createdAt ?? conversation.lastMessageAt;

      return {
        conversationId: conversation._id.toString(),
        lastMessageText: previewText,
        lastMessageAt: previewAt,
        user: {
          id: otherUser._id.toString(),
          displayName: sanitizeProfileText(String(otherUser.displayName ?? "")),
          email: otherUser.email,
          avatarUrl: sanitizeAvatarUrl(String(otherUser.avatarUrl ?? "")),
          about: sanitizeProfileText(String(otherUser.about ?? "")),
          isOnline: otherUser.isOnline,
          lastSeen: otherUser.lastSeen,
        },
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    conversations: items,
    nextCursor: conversations.length === limit ? conversations[conversations.length - 1].lastMessageAt : null,
  });
}

export async function DELETE(request: Request) {
  await connectToDatabase();

  const { authUser, error } = await requireAuth();

  if (error || !authUser) {
    return error;
  }

  const body = await request.json();
  const conversationId = String(body.conversationId ?? "").trim();
  const mode = String(body.mode ?? "everyone").trim().toLowerCase();

  if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
    return NextResponse.json({ error: "Valid conversationId is required." }, { status: 400 });
  }

  const conversation = await Conversation.findOne({
    _id: new Types.ObjectId(conversationId),
    participants: new Types.ObjectId(authUser.userId),
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (mode !== "me" && mode !== "everyone") {
    return NextResponse.json({ error: "mode must be 'me' or 'everyone'." }, { status: 400 });
  }

  if (mode === "me") {
    const currentUserObjectId = new Types.ObjectId(authUser.userId);
    const hiddenFor = conversation.hiddenFor ?? [];

    if (!hiddenFor.some((userId: Types.ObjectId) => userId.equals(currentUserObjectId))) {
      conversation.hiddenFor = [...hiddenFor, currentUserObjectId];
      await conversation.save();
    }

    await Message.updateMany(
      {
        conversationId: conversation._id,
        hiddenFor: { $ne: currentUserObjectId },
      },
      {
        $addToSet: {
          hiddenFor: currentUserObjectId,
        },
      }
    );

    return NextResponse.json({ success: true, conversationId, mode: "me" });
  }

  await Message.deleteMany({ conversationId: conversation._id });
  await Conversation.deleteOne({ _id: conversation._id });

  return NextResponse.json({ success: true, conversationId, mode: "everyone" });
}
