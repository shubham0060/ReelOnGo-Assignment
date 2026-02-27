const http = require("http");
const express = require("express");
const next = require("next");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const dotenv = require("dotenv");

dotenv.config({ path: ".env.local" });
dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const onlineCounts = new Map();
const socketToUser = new Map();

function getValidatedMongoUri() {
  const mongoUri = String(process.env.MONGODB_URI || "").trim();

  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI. Set it in your deployment environment variables.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  const looksLikeLocalhostMongo = /mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(mongoUri);

  if (isProduction && looksLikeLocalhostMongo) {
    throw new Error(
      "Invalid MONGODB_URI for production: localhost/127.0.0.1 is not reachable on Railway. Use a hosted MongoDB URI (for example, MongoDB Atlas)."
    );
  }

  return mongoUri;
}

function parseCookies(cookieHeader) {
  const cookieMap = {};

  if (!cookieHeader) {
    return cookieMap;
  }

  for (const item of cookieHeader.split(";")) {
    const [rawKey, ...rest] = item.trim().split("=");
    if (!rawKey) {
      continue;
    }

    cookieMap[rawKey] = decodeURIComponent(rest.join("="));
  }

  return cookieMap;
}

async function connectMongo() {
  if (mongoose.connection.readyState !== 1) {
    const mongoUri = getValidatedMongoUri();

    await mongoose.connect(mongoUri, {
      maxPoolSize: 20,
      minPoolSize: 5,
    });
  }
}

const userSchema = new mongoose.Schema(
  {
    isOnline: Boolean,
    lastSeen: Date,
  },
  { strict: false, collection: "users" }
);

const conversationSchema = new mongoose.Schema(
  {
    participants: [mongoose.Schema.Types.ObjectId],
  },
  { strict: false, collection: "conversations" }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);

app.prepare().then(async () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET.");
  }

  getValidatedMongoUri();

  await connectMongo();

  const expressApp = express();

  const httpServer = http.createServer(expressApp);

  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use((socket, nextMiddleware) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = cookies.connect_token;

      if (!token) {
        return nextMiddleware(new Error("Unauthorized"));
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.userId = payload.userId;
      return nextMiddleware();
    } catch {
      return nextMiddleware(new Error("Unauthorized"));
    }
  });

  async function canWatchPresence(watcherUserId, targetUserId) {
    if (!watcherUserId || !targetUserId) {
      return false;
    }

    if (watcherUserId === targetUserId) {
      return true;
    }

    if (!mongoose.Types.ObjectId.isValid(watcherUserId) || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return false;
    }

    const watcherObjectId = new mongoose.Types.ObjectId(watcherUserId);
    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);

    const exists = await Conversation.exists({
      participants: { $all: [watcherObjectId, targetObjectId] },
    });

    return Boolean(exists);
  }

  function emitPresenceUpdate(targetUserId, isOnline, lastSeen) {
    const payload = {
      userId: targetUserId,
      isOnline: Boolean(isOnline),
      lastSeen: new Date(lastSeen).toISOString(),
    };

    io.to(`presence:watch:${targetUserId}`).emit("presence:update", payload);
    io.to(`user:${targetUserId}`).emit("presence:update", payload);
  }

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    socketToUser.set(socket.id, userId);
    socket.join(`user:${userId}`);

    const count = (onlineCounts.get(userId) || 0) + 1;
    onlineCounts.set(userId, count);

    const now = new Date();
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: now });
    if (count === 1) {
      emitPresenceUpdate(userId, true, now);
    }

    socket.on("presence:subscribe", async ({ userId: targetUserId }) => {
      const normalizedTargetId = String(targetUserId || "").trim();
      if (!normalizedTargetId) {
        return;
      }

      const allowed = await canWatchPresence(userId, normalizedTargetId);
      if (!allowed) {
        return;
      }

      socket.join(`presence:watch:${normalizedTargetId}`);

      const targetUser = await User.findById(normalizedTargetId).select({ isOnline: 1, lastSeen: 1 }).lean();
      if (!targetUser) {
        return;
      }

      socket.emit("presence:update", {
        userId: normalizedTargetId,
        isOnline: Boolean(targetUser.isOnline || (onlineCounts.get(normalizedTargetId) || 0) > 0),
        lastSeen: new Date(targetUser.lastSeen || new Date()).toISOString(),
      });
    });

    socket.on("presence:unsubscribe", ({ userId: targetUserId }) => {
      const normalizedTargetId = String(targetUserId || "").trim();
      if (!normalizedTargetId) {
        return;
      }

      socket.leave(`presence:watch:${normalizedTargetId}`);
    });

    socket.on("conversation:join", ({ conversationId }) => {
      if (conversationId) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on("typing:update", ({ conversationId, toUserId, isTyping }) => {
      if (!toUserId || !conversationId) {
        return;
      }

      io.to(`user:${toUserId}`).emit("typing:update", {
        conversationId,
        fromUserId: userId,
        isTyping: Boolean(isTyping),
      });
    });

    socket.on("disconnect", async () => {
      const disconnectedUserId = socketToUser.get(socket.id);
      socketToUser.delete(socket.id);

      if (!disconnectedUserId) {
        return;
      }

      const updatedCount = Math.max((onlineCounts.get(disconnectedUserId) || 1) - 1, 0);

      if (updatedCount === 0) {
        onlineCounts.delete(disconnectedUserId);
        const now = new Date();
        await User.findByIdAndUpdate(disconnectedUserId, { isOnline: false, lastSeen: now });
        emitPresenceUpdate(disconnectedUserId, false, now);
      } else {
        onlineCounts.set(disconnectedUserId, updatedCount);
      }
    });
  });

  expressApp.post("/internal/realtime", express.json(), (req, res) => {
    const expectedSecret = process.env.INTERNAL_SOCKET_SECRET || process.env.JWT_SECRET;
    const receivedSecret = req.headers["x-internal-secret"];

    if (!receivedSecret || receivedSecret !== expectedSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { type, payload } = req.body || {};

    if (type === "message:new") {
      io.to(`conversation:${payload.conversationId}`).emit("message:new", payload);
      io.to(`user:${payload.recipientId}`).emit("message:new", payload);
      io.to(`user:${payload.senderId}`).emit("message:new", payload);
    }

    if (type === "message:read") {
      io.to(`conversation:${payload.conversationId}`).emit("message:read", payload);
    }

    if (type === "message:deleted") {
      if (payload.mode === "me") {
        io.to(`user:${payload.targetUserId}`).emit("message:deleted", payload);
      } else {
        io.to(`conversation:${payload.conversationId}`).emit("message:deleted", payload);
        io.to(`user:${payload.recipientId}`).emit("message:deleted", payload);
        io.to(`user:${payload.senderId}`).emit("message:deleted", payload);
      }
    }

    return res.json({ ok: true });
  });

  expressApp.use((req, res) => handle(req, res));

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
