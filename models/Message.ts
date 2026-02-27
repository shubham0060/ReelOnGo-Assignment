import { Schema, model, models, Types } from "mongoose";

export type MessageDocument = {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  recipientId: Types.ObjectId;
  text: string;
  readBy: Types.ObjectId[];
  hiddenFor: Types.ObjectId[];
  isDeletedForEveryone: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const messageSchema = new Schema<MessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true },
    readBy: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    hiddenFor: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    isDeletedForEveryone: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, hiddenFor: 1, createdAt: -1 });

export const Message = models.Message || model<MessageDocument>("Message", messageSchema);
