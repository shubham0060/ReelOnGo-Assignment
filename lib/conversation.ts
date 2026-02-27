import { Types } from "mongoose";
import { Conversation } from "@/models/Conversation";

export function buildParticipantKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

export async function getOrCreateConversation(userA: string, userB: string) {
  const participantKey = buildParticipantKey(userA, userB);
  const currentUserObjectId = new Types.ObjectId(userA);

  let conversation = await Conversation.findOne({ participantKey });

  if (!conversation) {
    conversation = await Conversation.create({
      participants: [currentUserObjectId, new Types.ObjectId(userB)],
      participantKey,
      hiddenFor: [],
      lastMessageAt: new Date(),
      lastMessageText: "",
    });
  } else if ((conversation.hiddenFor ?? []).some((userId: Types.ObjectId) => userId.equals(currentUserObjectId))) {
    conversation.hiddenFor = (conversation.hiddenFor ?? []).filter(
      (userId: Types.ObjectId) => !userId.equals(currentUserObjectId)
    );
    await conversation.save();
  }

  return conversation;
}
