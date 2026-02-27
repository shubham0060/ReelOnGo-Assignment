import { Schema, model, models, Types } from "mongoose";

export type UserDocument = {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  about: string;
  avatarUrl: string;
  isOnline: boolean;
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
};

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    about: { type: String, default: "Hey there! I am using Connect.", trim: true },
    avatarUrl: { type: String, default: "" },
    isOnline: { type: Boolean, default: false, index: true },
    lastSeen: { type: Date, default: new Date(), index: true },
  },
  { timestamps: true }
);

export const User = models.User || model<UserDocument>("User", userSchema);
