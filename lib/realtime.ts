import { EventEmitter } from "events";

export type MessageRealtimePayload = {
  conversationId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
};

export type TypingRealtimePayload = {
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  isTyping: boolean;
};

export type ReadRealtimePayload = {
  conversationId: string;
  readerId: string;
  messageIds: string[];
};

class RealtimeBus extends EventEmitter {}

const globalBus = globalThis as typeof globalThis & {
  realtimeBus?: RealtimeBus;
};

export const realtimeBus = globalBus.realtimeBus ?? new RealtimeBus();

if (!globalBus.realtimeBus) {
  globalBus.realtimeBus = realtimeBus;
}
