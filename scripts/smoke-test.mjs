import { io } from "socket.io-client";

const baseUrl = "http://localhost:3000";

function parseCookie(setCookieHeader) {
  if (!setCookieHeader) return "";
  const match = setCookieHeader.match(/connect_token=[^;]+/i);
  return match ? match[0] : "";
}

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed for ${email}: ${body}`);
  }

  const body = await response.json();
  const cookie = parseCookie(response.headers.get("set-cookie"));

  if (!cookie) {
    throw new Error(`Missing auth cookie for ${email}`);
  }

  return { user: body.user, cookie };
}

async function authedFetch(cookie, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(init.headers || {}),
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  }

  return json;
}

function onceWithTimeout(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload) {
      clearTimeout(timeout);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

async function main() {
  const alice = await login("alice.connect@example.com", "Pass@123");
  const bob = await login("bob.connect@example.com", "Pass@123");

  const bobMessages = await authedFetch(bob.cookie, `/api/messages?userId=${alice.user.id}`);
  const conversationId = bobMessages.conversationId;

  const aliceSocket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Cookie: alice.cookie },
  });

  const bobSocket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Cookie: bob.cookie },
  });

  await Promise.all([
    onceWithTimeout(aliceSocket, "connect"),
    onceWithTimeout(bobSocket, "connect"),
  ]);

  aliceSocket.emit("conversation:join", { conversationId });
  bobSocket.emit("conversation:join", { conversationId });

  const typingPromise = onceWithTimeout(bobSocket, "typing:update", 6000);
  aliceSocket.emit("typing:update", {
    conversationId,
    toUserId: bob.user.id,
    isTyping: true,
  });

  const typingPayload = await typingPromise;

  const messagePromise = onceWithTimeout(bobSocket, "message:new", 6000);
  await authedFetch(alice.cookie, "/api/messages", {
    method: "POST",
    body: JSON.stringify({ toUserId: bob.user.id, text: "smoke-test-message" }),
  });

  const messagePayload = await messagePromise;

  const readPromise = onceWithTimeout(aliceSocket, "message:read", 6000);
  await authedFetch(bob.cookie, "/api/messages/read", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
  const readPayload = await readPromise;

  aliceSocket.disconnect();
  bobSocket.disconnect();

  console.log("SMOKE_TEST_RESULT", {
    typingEvent: {
      fromUserId: typingPayload.fromUserId,
      isTyping: typingPayload.isTyping,
      conversationId: typingPayload.conversationId,
    },
    messageEvent: {
      senderId: messagePayload.senderId,
      recipientId: messagePayload.recipientId,
      text: messagePayload.text,
      conversationId: messagePayload.conversationId,
    },
    readEvent: {
      readerId: readPayload.readerId,
      updatedCount: Array.isArray(readPayload.messageIds) ? readPayload.messageIds.length : 0,
      conversationId: readPayload.conversationId,
    },
  });
}

main().catch((error) => {
  console.error("SMOKE_TEST_FAILED", error.message);
  process.exit(1);
});
