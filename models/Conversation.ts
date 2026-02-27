import { Schema, model, models, Types } from "mongoose";

export type ConversationDocument = {
  _id: Types.ObjectId;
  participants: Types.ObjectId[];
  participantKey: string;
  hiddenFor: Types.ObjectId[];
  lastMessageText: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const conversationSchema = new Schema<ConversationDocument>(
  {
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
      validate: {
        validator: (value: Types.ObjectId[]) => value.length === 2,
        message: "Only one-on-one conversations are supported.",
      },
      index: true,
    },
    participantKey: { type: String, required: true, unique: true, index: true },
    hiddenFor: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
      index: true,
    },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: new Date(), index: true },
  },
  { timestamps: true }
);

export const Conversation =
  models.Conversation || model<ConversationDocument>("Conversation", conversationSchema);
