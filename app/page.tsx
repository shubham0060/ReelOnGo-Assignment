"use client";

import { ChangeEvent, FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { io, Socket } from "socket.io-client";

type User = {
  id: string;
  email: string;
  displayName: string;
  about: string;
  avatarUrl: string;
  isOnline: boolean;
  lastSeen: string;
};

type Conversation = {
  conversationId: string;
  lastMessageText: string;
  lastMessageAt: string;
  user: User;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  text: string;
  readBy: string[];
  isDeletedForEveryone: boolean;
  deletedAt: string | null;
  createdAt: string;
};

type AuthResponse = {
  user: User;
};

type RealtimeMessagePayload = Omit<Message, "id" | "readBy"> & { messageId: string };

type DashboardMode = "chat" | "profile";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatShortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

const formatLastSeen = (user: User) => {
  if (user.isOnline) {
    return "Active now";
  }

  return `Last seen ${new Date(user.lastSeen).toLocaleString()}`;
};

const getInitials = (name: string) => {
  const parts = name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
};

function Avatar({ user, size = 40 }: { user: Pick<User, "displayName" | "avatarUrl">; size?: number }) {
  if (user.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt={user.displayName}
        width={size}
        height={size}
        className="rounded-full object-cover"
        unoptimized
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-full bg-black/80 text-xs font-semibold text-white"
    >
      {getInitials(user.displayName)}
    </div>
  );
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Failed to connect to server. Please make sure the app server is running.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown = null;

  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    try {
      body = await response.text();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    if (body && typeof body === "object") {
      const payload = body as { error?: string; message?: string };
      throw new Error(payload.error ?? payload.message ?? `Request failed (${response.status})`);
    }

    if (typeof body === "string" && body.trim()) {
      throw new Error(body.trim());
    }

    throw new Error(`Request failed (${response.status})`);
  }

  return body as T;
}

export default function Home() {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [submittingAuth, setSubmittingAuth] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [me, setMe] = useState<User | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [about, setAbout] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarError, setAvatarError] = useState("");

  const [mode, setMode] = useState<DashboardMode>("chat");
  const [darkMode, setDarkMode] = useState(false);
  const [newChatMode, setNewChatMode] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeUser, setActiveUser] = useState<User | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<Conversation | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [userDetailsActive, setUserDetailsActive] = useState(false);

  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [typingDots, setTypingDots] = useState(1);

  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const incomingTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingActiveRef = useRef(false);
  const lastTypingKeepAliveRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const preserveScrollRef = useRef<{ previousHeight: number; previousTop: number } | null>(null);
  const shouldAutoScrollRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const userDetailsCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const meRef = useRef<User | null>(null);
  const activeUserRef = useRef<User | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const presenceSubscribedIdsRef = useRef<Set<string>>(new Set());

  const selectedUser = useMemo(() => {
    if (!activeUser) {
      return null;
    }

    return (
      users.find((user) => user.id === activeUser.id) ??
      conversations.find((conversation) => conversation.user.id === activeUser.id)?.user ??
      activeUser
    );
  }, [activeUser, conversations, users]);

  const hasActiveSearch = searchQuery.trim().length > 0;
  const showPeopleResults = hasActiveSearch || newChatMode;

  const filteredConversations = useMemo(() => {
    if (!hasActiveSearch) {
      return conversations;
    }

    const query = searchQuery.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const nameMatch = conversation.user.displayName.toLowerCase().includes(query);
      const messageMatch = conversation.lastMessageText.toLowerCase().includes(query);
      return nameMatch || messageMatch;
    });
  }, [conversations, hasActiveSearch, searchQuery]);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    activeUserRef.current = activeUser;
  }, [activeUser]);

  useEffect(() => {
    setTypingUserId(null);

    isTypingActiveRef.current = false;
    lastTypingKeepAliveRef.current = 0;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (incomingTypingTimeoutRef.current) {
      clearTimeout(incomingTypingTimeoutRef.current);
      incomingTypingTimeoutRef.current = null;
    }
  }, [activeUser?.id]);

  useEffect(() => {
    if (!typingUserId) {
      setTypingDots(1);
      return;
    }

    const interval = setInterval(() => {
      setTypingDots((previous) => (previous >= 3 ? 1 : previous + 1));
    }, 360);

    return () => clearInterval(interval);
  }, [typingUserId]);

  useEffect(() => {
    return () => {
      if (userDetailsCloseTimeoutRef.current) {
        clearTimeout(userDetailsCloseTimeoutRef.current);
        userDetailsCloseTimeoutRef.current = null;
      }
    };
  }, []);

  const resetUserDetailsPanel = () => {
    if (userDetailsCloseTimeoutRef.current) {
      clearTimeout(userDetailsCloseTimeoutRef.current);
      userDetailsCloseTimeoutRef.current = null;
    }

    setUserDetailsActive(false);
    setShowUserDetails(false);
  };

  const openUserDetailsPanel = () => {
    if (userDetailsCloseTimeoutRef.current) {
      clearTimeout(userDetailsCloseTimeoutRef.current);
      userDetailsCloseTimeoutRef.current = null;
    }

    setShowUserDetails(true);
    window.requestAnimationFrame(() => {
      setUserDetailsActive(true);
    });
  };

  const closeUserDetailsPanel = () => {
    setUserDetailsActive(false);

    if (userDetailsCloseTimeoutRef.current) {
      clearTimeout(userDetailsCloseTimeoutRef.current);
    }

    userDetailsCloseTimeoutRef.current = setTimeout(() => {
      setShowUserDetails(false);
      userDetailsCloseTimeoutRef.current = null;
    }, 280);
  };

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const loadMe = async () => {
      try {
        const body = await readJson<{ user: User }>("/api/auth/me");
        setMe(body.user);
        setDisplayName(body.user.displayName);
        setAbout(body.user.about);
        setAvatarUrl(body.user.avatarUrl);
      } catch {
      } finally {
        setLoadingAuth(false);
      }
    };

    void loadMe();
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("connect-theme");
    if (savedTheme === "dark") {
      setDarkMode(true);
      return;
    }

    if (savedTheme === "light") {
      setDarkMode(false);
      return;
    }

    setDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  const toggleDarkMode = () => {
    setDarkMode((previous) => {
      const next = !previous;
      window.localStorage.setItem("connect-theme", next ? "dark" : "light");
      return next;
    });
  };

  const loadUsers = async (query = "") => {
    const result = await readJson<{ users: User[] }>(`/api/users?query=${encodeURIComponent(query)}`);
    setUsers(result.users);
  };

  const loadConversations = async () => {
    const result = await readJson<{ conversations: Conversation[] }>("/api/conversations");
    setConversations(result.conversations);
  };

  const loadMessages = async (userId: string, cursor?: string | null, replace = false) => {
    setLoadingMessages(true);

    if (!replace && cursor && messagesContainerRef.current) {
      preserveScrollRef.current = {
        previousHeight: messagesContainerRef.current.scrollHeight,
        previousTop: messagesContainerRef.current.scrollTop,
      };
      shouldAutoScrollRef.current = false;
    } else if (replace) {
      preserveScrollRef.current = null;
      shouldAutoScrollRef.current = true;
    }

    try {
      const query = new URLSearchParams({ userId });
      if (cursor) {
        query.set("cursor", cursor);
      }

      const result = await readJson<{
        conversationId: string;
        messages: Message[];
        nextCursor: string | null;
      }>(`/api/messages?${query.toString()}`);

      setConversationId(result.conversationId);
      setMessageCursor(result.nextCursor);

      setMessages((previous) => {
        if (replace) {
          return result.messages;
        }

        const existingIds = new Set(previous.map((message) => message.id));
        const older = result.messages.filter((message) => !existingIds.has(message.id));
        return [...older, ...previous];
      });

      socketRef.current?.emit("conversation:join", { conversationId: result.conversationId });

      await readJson<{ updated: number }>("/api/messages/read", {
        method: "POST",
        body: JSON.stringify({ conversationId: result.conversationId }),
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (!me?.id) {
      return;
    }

    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on("message:new", (payload: RealtimeMessagePayload) => {
      const currentMe = meRef.current;

      if (!currentMe) {
        return;
      }

      const incoming: Message = {
        id: payload.messageId,
        conversationId: payload.conversationId,
        senderId: payload.senderId,
        recipientId: payload.recipientId,
        text: payload.text,
        readBy: [payload.senderId],
        isDeletedForEveryone: false,
        deletedAt: null,
        createdAt: payload.createdAt,
      };

      setMessages((previous) => {
        if (previous.some((message) => message.id === incoming.id)) {
          return previous;
        }

        if (conversationIdRef.current && incoming.conversationId !== conversationIdRef.current) {
          return previous;
        }

        shouldAutoScrollRef.current = true;

        return [...previous, incoming];
      });

      const otherId = incoming.senderId === currentMe.id ? incoming.recipientId : incoming.senderId;
      setConversations((previous) => {
        const existingIndex = previous.findIndex((conversation) => conversation.user.id === otherId);

        if (existingIndex === -1) {
          return previous;
        }

        const updated = [...previous];
        const [conversation] = updated.splice(existingIndex, 1);
        updated.unshift({
          ...conversation,
          lastMessageText: incoming.text,
          lastMessageAt: incoming.createdAt,
        });

        return updated;
      });

      if (incoming.senderId === activeUserRef.current?.id && incoming.conversationId) {
        void readJson<{ updated: number }>("/api/messages/read", {
          method: "POST",
          body: JSON.stringify({ conversationId: incoming.conversationId }),
        });
      }
    });

    socket.on("typing:update", (payload: { conversationId: string; fromUserId: string; isTyping: boolean }) => {
      if (payload.fromUserId !== activeUserRef.current?.id) {
        return;
      }

      if (conversationIdRef.current && payload.conversationId !== conversationIdRef.current) {
        return;
      }

      if (!payload.isTyping) {
        setTypingUserId(null);

        if (incomingTypingTimeoutRef.current) {
          clearTimeout(incomingTypingTimeoutRef.current);
          incomingTypingTimeoutRef.current = null;
        }

        return;
      }

      setTypingUserId(payload.fromUserId);

      if (incomingTypingTimeoutRef.current) {
        clearTimeout(incomingTypingTimeoutRef.current);
      }

      incomingTypingTimeoutRef.current = setTimeout(() => {
        setTypingUserId(null);
        incomingTypingTimeoutRef.current = null;
      }, 1200);
    });

    socket.on("presence:update", (payload: { userId: string; isOnline: boolean; lastSeen: string }) => {
      setUsers((previous) =>
        previous.map((user) =>
          user.id === payload.userId
            ? { ...user, isOnline: payload.isOnline, lastSeen: payload.lastSeen }
            : user
        )
      );

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.user.id === payload.userId
            ? {
                ...conversation,
                user: {
                  ...conversation.user,
                  isOnline: payload.isOnline,
                  lastSeen: payload.lastSeen,
                },
              }
            : conversation
        )
      );
    });

    socket.on("message:read", (payload: { conversationId: string; readerId: string; messageIds: string[] }) => {
      if (conversationIdRef.current && payload.conversationId !== conversationIdRef.current) {
        return;
      }

      setMessages((previous) =>
        previous.map((message) =>
          payload.messageIds.includes(message.id)
            ? {
                ...message,
                readBy: message.readBy.includes(payload.readerId)
                  ? message.readBy
                  : [...message.readBy, payload.readerId],
              }
            : message
        )
      );
    });

    socket.on("message:deleted", (payload: { conversationId: string; messageId: string; mode: "me" | "everyone"; deletedAt?: string }) => {
      if (conversationIdRef.current && payload.conversationId === conversationIdRef.current) {
        setMessages((previous) => {
          if (payload.mode === "me") {
            return previous.filter((message) => message.id !== payload.messageId);
          }

          return previous.map((message) =>
            message.id === payload.messageId
              ? {
                  ...message,
                  text: "",
                  isDeletedForEveryone: true,
                  deletedAt: payload.deletedAt ?? message.deletedAt ?? new Date().toISOString(),
                }
              : message
          );
        });
      }

      void loadConversations();
    });

    return () => {
      if (incomingTypingTimeoutRef.current) {
        clearTimeout(incomingTypingTimeoutRef.current);
        incomingTypingTimeoutRef.current = null;
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      isTypingActiveRef.current = false;
      lastTypingKeepAliveRef.current = 0;

      socket.disconnect();
      socketRef.current = null;
      presenceSubscribedIdsRef.current = new Set();
    };
  }, [me?.id]);

  useEffect(() => {
    if (!me?.id) {
      return;
    }

    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const nextSubscribedIds = new Set<string>();

    for (const conversation of conversations) {
      if (conversation.user.id && conversation.user.id !== me.id) {
        nextSubscribedIds.add(conversation.user.id);
      }
    }

    for (const user of users) {
      if (user.id && user.id !== me.id) {
        nextSubscribedIds.add(user.id);
      }
    }

    if (activeUser?.id && activeUser.id !== me.id) {
      nextSubscribedIds.add(activeUser.id);
    }

    const previousSubscribedIds = presenceSubscribedIdsRef.current;

    for (const userId of nextSubscribedIds) {
      if (!previousSubscribedIds.has(userId)) {
        socket.emit("presence:subscribe", { userId });
      }
    }

    for (const userId of previousSubscribedIds) {
      if (!nextSubscribedIds.has(userId)) {
        socket.emit("presence:unsubscribe", { userId });
      }
    }

    presenceSubscribedIdsRef.current = nextSubscribedIds;
  }, [me?.id, conversations, users, activeUser?.id]);

  useEffect(() => {
    if (!me) {
      return;
    }

    void loadUsers(searchQuery);
    void loadConversations();
  }, [me]);

  useEffect(() => {
    if (!me) {
      return;
    }

    const timer = setTimeout(() => {
      void loadUsers(searchQuery);
    }, 250);

    return () => clearTimeout(timer);
  }, [me, searchQuery]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    if (preserveScrollRef.current) {
      const { previousHeight, previousTop } = preserveScrollRef.current;
      const newHeight = container.scrollHeight;
      container.scrollTop = previousTop + (newHeight - previousHeight);
      preserveScrollRef.current = null;
      return;
    }

    if (shouldAutoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      shouldAutoScrollRef.current = false;
    }
  }, [messages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const sentinel = topSentinelRef.current;

    if (!container || !sentinel || !selectedUser || !messageCursor) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadingMessages) {
          return;
        }

        void loadMessages(selectedUser.id, messageCursor, false);
      },
      {
        root: container,
        threshold: 0.1,
        rootMargin: "80px 0px 0px 0px",
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [selectedUser?.id, messageCursor, loadingMessages]);

  const onSubmitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmittingAuth(true);

    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        authMode === "login"
          ? { email, password }
          : {
              email,
              password,
              displayName,
            };

      const result = await readJson<AuthResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setMe(result.user);
      setDisplayName(result.user.displayName);
      setAbout(result.user.about);
      setAvatarUrl(result.user.avatarUrl);
      setPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed");
    } finally {
      setSubmittingAuth(false);
    }
  };

  const onLogout = async () => {
    await readJson<{ success: boolean }>("/api/auth/logout", { method: "POST" });
    setMe(null);
    setUsers([]);
    setConversations([]);
    setMessages([]);
    setActiveUser(null);
    setConversationId(null);
    setMode("chat");
  };

  const onSaveProfile = async () => {
    setProfileSaving(true);
    setError("");

    try {
      const result = await readJson<AuthResponse>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ displayName, about, avatarUrl }),
      });

      setMe(result.user);
      setUsers((previous) =>
        previous.map((user) =>
          user.id === result.user.id
            ? {
                ...user,
                displayName: result.user.displayName,
                about: result.user.about,
                avatarUrl: result.user.avatarUrl,
              }
            : user
        )
      );
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.user.id === result.user.id
            ? {
                ...conversation,
                user: {
                  ...conversation.user,
                  displayName: result.user.displayName,
                  about: result.user.about,
                  avatarUrl: result.user.avatarUrl,
                },
              }
            : conversation
        )
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const onCancelProfile = () => {
    if (!me) {
      return;
    }

    setDisplayName(me.displayName);
    setAbout(me.about);
    setAvatarUrl(me.avatarUrl);
    setAvatarError("");
  };

  const onAvatarFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }

    if (file.size > 700 * 1024) {
      setAvatarError("Image is too large. Use an image under 700KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      setAvatarUrl(result);
      setAvatarError("");
    };
    reader.onerror = () => {
      setAvatarError("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const openChat = async (user: User) => {
    if (activeUser && conversationId && socketRef.current && isTypingActiveRef.current) {
      socketRef.current.emit("typing:update", {
        conversationId,
        toUserId: activeUser.id,
        isTyping: false,
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    isTypingActiveRef.current = false;
    lastTypingKeepAliveRef.current = 0;

    setMode("chat");
    setNewChatMode(false);
    setActiveUser(user);
    resetUserDetailsPanel();
    setMessages([]);
    setMessageCursor(null);
    setTypingUserId(null);
    preserveScrollRef.current = null;
    shouldAutoScrollRef.current = true;

    await loadMessages(user.id, null, true);

    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const onStartNewChat = () => {
    if (activeUser && conversationId && socketRef.current && isTypingActiveRef.current) {
      socketRef.current.emit("typing:update", {
        conversationId,
        toUserId: activeUser.id,
        isTyping: false,
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    isTypingActiveRef.current = false;
    lastTypingKeepAliveRef.current = 0;

    setMode("chat");
    setActiveUser(null);
    resetUserDetailsPanel();
    setSearchQuery("");
    setNewChatMode(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const onType = (nextValue: string) => {
    setMessageText(nextValue);

    if (!activeUser || !conversationId || !socketRef.current) {
      return;
    }

    const trimmed = nextValue.trim();
    const now = Date.now();

    if (!trimmed) {
      if (isTypingActiveRef.current) {
        socketRef.current.emit("typing:update", {
          conversationId,
          toUserId: activeUser.id,
          isTyping: false,
        });
      }

      isTypingActiveRef.current = false;
      lastTypingKeepAliveRef.current = 0;

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      return;
    }

    if (!isTypingActiveRef.current || now - lastTypingKeepAliveRef.current >= 1000) {
      socketRef.current.emit("typing:update", {
        conversationId,
        toUserId: activeUser.id,
        isTyping: true,
      });

      isTypingActiveRef.current = true;
      lastTypingKeepAliveRef.current = now;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("typing:update", {
        conversationId,
        toUserId: activeUser.id,
        isTyping: false,
      });

      isTypingActiveRef.current = false;
      lastTypingKeepAliveRef.current = 0;
      typingTimeoutRef.current = null;
    }, 450);
  };

  const onSendMessage = async (event: FormEvent) => {
    event.preventDefault();

    if (!activeUser || !messageText.trim()) {
      return;
    }

    setSendingMessage(true);

    try {
      const result = await readJson<{ message: Message }>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ toUserId: activeUser.id, text: messageText }),
      });

      setMessageText("");

      if (conversationId && socketRef.current) {
        if (isTypingActiveRef.current) {
          socketRef.current.emit("typing:update", {
            conversationId,
            toUserId: activeUser.id,
            isTyping: false,
          });
        }

        isTypingActiveRef.current = false;
        lastTypingKeepAliveRef.current = 0;

        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }

      setMessages((previous) => {
        shouldAutoScrollRef.current = true;

        if (previous.some((message) => message.id === result.message.id)) {
          return previous;
        }

        return [...previous, result.message];
      });

      window.requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });

      await loadConversations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to send message");
    } finally {
      setSendingMessage(false);
    }
  };

  const onDeleteConversationFromList = async (
    mode: "me" | "everyone"
  ) => {
    if (!pendingDeleteConversation) {
      return;
    }

    const conversation = pendingDeleteConversation;

    setDeletingChat(true);
    setError("");

    try {
      await readJson<{ success: boolean; conversationId: string; mode: "me" | "everyone" }>("/api/conversations", {
        method: "DELETE",
        body: JSON.stringify({ conversationId: conversation.conversationId, mode }),
      });

      setConversations((previous) =>
        previous.filter((item) => item.conversationId !== conversation.conversationId)
      );

      if (conversationId === conversation.conversationId || activeUser?.id === conversation.user.id) {
        onBackToConversations();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to delete chat");
    } finally {
      setDeletingChat(false);
      setMenuConversationId(null);
      setPendingDeleteConversation(null);
    }
  };

  const onOpenMessageMenu = (event: MouseEvent, message: Message) => {
    event.preventDefault();

    const menuWidth = 190;
    const menuHeight = 56;
    const safeX = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const safeY = Math.min(event.clientY, window.innerHeight - menuHeight - 8);

    setMessageMenu({
      message,
      x: Math.max(8, safeX),
      y: Math.max(8, safeY),
    });
  };

  const onDeleteMessage = async (mode: "me" | "everyone") => {
    if (!pendingDeleteMessage || !me) {
      return;
    }

    const targetMessage = pendingDeleteMessage;
    if (mode === "everyone" && targetMessage.senderId !== me.id) {
      return;
    }

    if (mode === "everyone" && targetMessage.isDeletedForEveryone) {
      return;
    }

    setDeletingMessage(true);
    setError("");

    try {
      await readJson<{ success: boolean; messageId: string; mode: "me" | "everyone" }>("/api/messages", {
        method: "DELETE",
        body: JSON.stringify({ messageId: targetMessage.id, mode }),
      });

      if (mode === "me") {
        setMessages((previous) => previous.filter((message) => message.id !== targetMessage.id));
      } else {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === targetMessage.id
              ? {
                  ...message,
                  text: "",
                  isDeletedForEveryone: true,
                  deletedAt: new Date().toISOString(),
                }
              : message
          )
        );
      }

      await loadConversations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to delete message");
    } finally {
      setDeletingMessage(false);
      setPendingDeleteMessage(null);
    }
  };

  const onBackToConversations = () => {
    if (activeUser && conversationId && socketRef.current && isTypingActiveRef.current) {
      socketRef.current.emit("typing:update", {
        conversationId,
        toUserId: activeUser.id,
        isTyping: false,
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    isTypingActiveRef.current = false;
    lastTypingKeepAliveRef.current = 0;

    setActiveUser(null);
    setConversationId(null);
    setMessages([]);
    setTypingUserId(null);
    resetUserDetailsPanel();
    setNewChatMode(false);
  };

  const appFont = '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
  const appShellClasses = darkMode
    ? "border border-[#0da6f2]/15 bg-[#101c22]/70 text-slate-100"
    : "border border-white/70 bg-[rgba(255,255,255,0.35)] text-slate-900";
  const panelClasses = darkMode
    ? "border-[#0da6f2]/10 bg-[#101c22]/70 backdrop-blur-xl"
    : "border-white/30 bg-white/10";
  const softInputClasses = darkMode
    ? "border border-[#0da6f2]/10 bg-slate-900/60 text-slate-200 placeholder:text-slate-500"
    : "border-0 bg-white/60 text-slate-900 placeholder:text-slate-500";

  if (loadingAuth) {
    return (
      <div
        className={`flex min-h-screen items-center justify-center ${
          darkMode ? "bg-gradient-to-br from-slate-950 to-slate-900" : "bg-gradient-to-br from-[#c4dad7] to-[#e2eeec]"
        }`}
      >
        <p className={`text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Loading Connect...</p>
      </div>
    );
  }

  if (!me) {
    return (
      <main
        style={{ fontFamily: appFont }}
        className={`min-h-screen px-4 py-10 ${
          darkMode ? "bg-gradient-to-br from-slate-950 to-slate-900" : "bg-gradient-to-br from-[#c4dad7] to-[#e2eeec]"
        }`}
      >
        <div className="mx-auto flex min-h-[85vh] w-full max-w-md items-center justify-center">
          <form
            onSubmit={onSubmitAuth}
            className={`w-full space-y-4 rounded-[2rem] p-7 shadow-2xl backdrop-blur-xl ${
              darkMode
                ? "border-white/10 bg-slate-900/70"
                : "border-white/70 bg-[rgba(255,255,255,0.45)]"
            }`}
          >
            <h1 className={`text-3xl font-bold tracking-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Connect</h1>
            <p className={`text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Global real-time messaging app</p>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              <span>Email</span>
              <input
                type="email"
                className="w-full rounded-2xl border border-white/70 bg-white/60 px-4 py-3 text-[15px]"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              <span>Password</span>
              <input
                type="password"
                className="w-full rounded-2xl border border-white/70 bg-white/60 px-4 py-3 text-[15px]"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {authMode === "register" && (
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>Display name</span>
                <input
                  className="w-full rounded-2xl border border-white/70 bg-white/60 px-4 py-3 text-[15px]"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </label>
            )}

            <button
              type="submit"
              disabled={submittingAuth}
              className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-70"
            >
              {submittingAuth ? "Please wait..." : authMode === "login" ? "Login" : "Register"}
            </button>

            <button
              type="button"
              onClick={() => setAuthMode((previous) => (previous === "login" ? "register" : "login"))}
              className="w-full text-sm font-medium text-slate-700 underline"
            >
              {authMode === "login" ? "Need an account? Register" : "Have an account? Login"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{ fontFamily: appFont }}
      className={`h-[100dvh] overflow-hidden p-2 sm:p-3 md:p-4 ${
        darkMode
          ? "bg-gradient-to-br from-[#0a1114] via-[#101c22] to-slate-900 text-slate-100"
          : "bg-gradient-to-br from-[#c4dad7] to-[#e2eeec]"
      }`}
    >
      <div
        className={`flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[1.4rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.08)] backdrop-blur-2xl md:flex-row md:rounded-[2rem] ${appShellClasses}`}
      >
        <aside className={`flex w-full shrink-0 flex-row items-center justify-between border-b px-3 py-3 sm:px-4 md:w-24 md:flex-col md:border-b-0 md:border-r md:px-0 md:py-8 ${panelClasses}`}>
          <div className="flex items-center gap-4 md:flex-col md:gap-7">
            <div className="flex items-center gap-2.5 md:flex-col md:gap-2.5">
              <p className={`text-sm font-bold tracking-tight md:hidden ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Connect</p>
              <p className={`hidden text-sm font-extrabold uppercase tracking-[0.14em] md:block ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Connect</p>
            </div>
            <nav className="flex items-center gap-2 md:flex-col md:gap-4">
              <button
                className={`flex h-11 w-11 items-center justify-center rounded-xl md:h-12 md:w-12 md:rounded-2xl ${
                  mode === "chat"
                    ? "bg-[#0da6f2] text-white shadow-lg shadow-[#0da6f2]/25"
                    : darkMode
                      ? "text-slate-500 hover:bg-slate-800/50 hover:text-[#0da6f2]"
                      : "text-slate-500 hover:bg-white/40"
                }`}
                onClick={() => setMode("chat")}
              >
                💬
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-2 md:flex-col md:gap-4">
            <button
              type="button"
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className={`flex h-11 w-11 items-center justify-center rounded-xl md:h-12 md:w-12 md:rounded-2xl ${
                darkMode
                  ? "bg-slate-800/70 text-slate-200 hover:bg-slate-700/70"
                  : "text-slate-500 hover:bg-white/40"
              } smooth-interactive`}
              onClick={toggleDarkMode}
            >
              {darkMode ? "☀" : "🌙"}
            </button>
            <button
              className="h-11 w-11 overflow-hidden rounded-xl border-2 border-black/10 p-0.5 md:h-12 md:w-12 md:rounded-2xl smooth-interactive"
              onClick={() => setMode("profile")}
            >
              <Avatar user={me} size={42} />
            </button>
          </div>
        </aside>

        {mode === "chat" ? (
          <div className="flex min-h-0 flex-1">
            <section
              className={`${activeUser ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r md:w-96 ${panelClasses}`}
            >
              <div className="p-4 pb-3 sm:p-6 sm:pb-4 md:p-8 md:pb-4">
                <div className="mb-5 flex items-center justify-between sm:mb-6 md:mb-8">
                  <h2 className={`text-xl font-bold leading-tight tracking-tight sm:text-2xl ${darkMode ? "text-white" : "text-slate-900"}`}>Messages</h2>
                  <button
                    type="button"
                    onClick={onStartNewChat}
                    title="Start new chat"
                    className={`flex h-8 w-8 items-center justify-center rounded-full ${darkMode ? "text-[#0da6f2] hover:bg-[#0da6f2]/10" : "text-slate-700 hover:bg-white/40"} smooth-interactive`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </div>
                <div className="relative">
                  <span className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${darkMode ? "text-slate-500" : "text-slate-500"}`}>⌕</span>
                  <input
                    ref={searchInputRef}
                    className={`w-full rounded-2xl py-3.5 pl-12 pr-4 text-sm font-medium focus:outline-none ${softInputClasses}`}
                    placeholder="Search discussions..."
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      if (event.target.value.trim()) {
                        setNewChatMode(false);
                      }
                    }}
                  />
                </div>
              </div>

              <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
                {filteredConversations.map((conversation) => {
                  const isActive = conversation.user.id === activeUser?.id;
                  const isTyping = typingUserId === conversation.user.id;

                  return (
                    <div
                      key={conversation.conversationId}
                      onMouseLeave={() => {
                        if (menuConversationId === conversation.conversationId) {
                          setMenuConversationId(null);
                        }
                      }}
                      className={`group relative w-full rounded-[1.5rem] border transition sm:rounded-[2rem] smooth-interactive fade-in-soft ${
                        isActive
                          ? darkMode
                            ? "border-[#0da6f2]/30 bg-[#0da6f2]/10 shadow-sm"
                            : "border-white/80 bg-white/70 shadow-sm"
                          : darkMode
                            ? "border-transparent hover:bg-slate-800/40"
                            : "border-transparent hover:bg-white/50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuConversationId(null);
                          void openChat(conversation.user);
                        }}
                        className="w-full cursor-pointer rounded-[1.5rem] p-3.5 pr-12 text-left sm:rounded-[2rem] sm:p-4 sm:pr-14 smooth-interactive"
                      >
                        <div className="flex items-center gap-4">
                          <div className="relative shrink-0">
                            <Avatar user={conversation.user} size={56} />
                            {conversation.user.isOnline && (
                              <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-green-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-baseline justify-between">
                              <h4 className={`truncate text-[15px] font-semibold leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>{conversation.user.displayName}</h4>
                              <span className={`text-[11px] font-semibold tracking-[0.01em] ${darkMode ? "text-[#0da6f2]" : "text-slate-500"}`}>{formatShortTime(conversation.lastMessageAt)}</span>
                            </div>
                            {isTyping ? (
                              <p className="truncate text-xs font-semibold leading-5 text-green-400">Typing...</p>
                            ) : (
                              <p className={`truncate text-xs leading-5 ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{conversation.lastMessageText || "No messages yet"}</p>
                            )}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuConversationId((previous) =>
                            previous === conversation.conversationId ? null : conversation.conversationId
                          );
                        }}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 transition md:opacity-0 md:group-hover:opacity-100 smooth-interactive ${
                          menuConversationId === conversation.conversationId ? "opacity-100" : "opacity-90"
                        } ${darkMode ? "text-slate-300 hover:bg-slate-700/60" : "text-slate-600 hover:bg-white/80"}`}
                        title="More"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>

                      {menuConversationId === conversation.conversationId && (
                        <div
                          className={`absolute right-3 top-[calc(50%+1.75rem)] z-20 min-w-[140px] rounded-xl border p-1.5 shadow-xl ${
                            darkMode
                              ? "border-[#0da6f2]/20 bg-slate-900/95"
                              : "border-slate-200 bg-white"
                          } fade-in-soft`}
                        >
                          <button
                            type="button"
                            disabled={deletingChat}
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuConversationId(null);
                              setPendingDeleteConversation(conversation);
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold disabled:opacity-60 ${
                              darkMode
                                ? "text-red-300 hover:bg-red-500/15"
                                : "text-red-600 hover:bg-red-50"
                            }`}
                          >
                            Delete chat
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!filteredConversations.length && (
                  <p className={`px-2 text-sm font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {hasActiveSearch ? "No matching results." : "No conversations yet. Search a user to begin."}
                  </p>
                )}

                {showPeopleResults && (
                  <div className={`mt-4 space-y-1 border-t pt-4 ${darkMode ? "border-[#0da6f2]/10" : "border-white/30"}`}>
                    <p className={`px-2 text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-slate-500" : "text-slate-500"}`}>People</p>
                    {users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => void openChat(user)}
                        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${darkMode ? "hover:bg-slate-800/40" : "hover:bg-white/40"}`}
                      >
                        <Avatar user={user} size={36} />
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold leading-tight ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{user.displayName}</p>
                          <p className={`truncate text-xs leading-5 ${darkMode ? "text-slate-500" : "text-slate-500"}`}>{formatLastSeen(user)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <main className={`${activeUser ? "flex" : "hidden md:flex"} relative min-w-0 flex-1 flex-col ${darkMode ? "bg-[#101c22]/35" : "bg-white/5"}`}>
              <header className={`border-b px-3 py-3.5 sm:px-4 sm:py-4 md:px-10 md:py-6 ${panelClasses}`}>
                {!selectedUser ? (
                  <div className={`text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Choose a conversation to start chatting.</div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border md:hidden smooth-interactive ${
                          darkMode
                            ? "border-[#0da6f2]/25 bg-[#0da6f2]/12 text-slate-100 hover:bg-[#0da6f2]/20"
                            : "border-slate-200 bg-white/85 text-slate-700 hover:bg-white"
                        }`}
                        onClick={onBackToConversations}
                        aria-label="Back to conversations"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M15 18l-6-6 6-6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={openUserDetailsPanel}
                        className="relative rounded-full focus:outline-none"
                        aria-label="Open user details"
                      >
                        <Avatar user={selectedUser} size={48} />
                        {selectedUser.isOnline && (
                          <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-[#101c22] bg-green-500" />
                        )}
                      </button>
                      <div>
                        <h3 className={`text-[17px] font-semibold leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>{selectedUser.displayName}</h3>
                        {typingUserId === selectedUser.id ? (
                          <p className={`flex items-center gap-1.5 text-[13px] font-semibold leading-5 ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                            <span className={`h-2 w-2 rounded-full ${darkMode ? "bg-emerald-300" : "bg-emerald-600"}`} />
                            {`Typing${".".repeat(typingDots)}`}
                          </p>
                        ) : (
                          <p className={`text-[13px] font-medium leading-5 ${darkMode ? "text-green-400" : "text-slate-600"}`}>{formatLastSeen(selectedUser)}</p>
                        )}
                      </div>
                    </div>

                    <div className="hidden items-center gap-3 md:flex" />
                  </div>
                )}
              </header>

              <div
                ref={messagesContainerRef}
                className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6 md:px-10 md:py-8"
              >
                <div ref={topSentinelRef} className="h-0.5" />

                {loadingMessages && !!messageCursor && (
                  <div className="mb-4 text-center text-xs font-medium text-slate-500">Loading older messages...</div>
                )}

                <div className="space-y-6">
                  {messages.map((message) => {
                    const mine = message.senderId === me.id;
                    const isReadByRecipient = !!activeUser && message.readBy.includes(activeUser.id);

                    return (
                      <div
                        key={message.id}
                        onContextMenu={(event) => onOpenMessageMenu(event, message)}
                        className={`flex gap-3 ${mine ? "justify-end" : "justify-start"}`}
                      >
                        {!mine && selectedUser && <Avatar user={selectedUser} size={40} />}

                        <div className={`max-w-[92%] sm:max-w-[85%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                          <div
                            className={`rounded-[1.6rem] px-5 py-3 text-[15px] font-medium leading-[1.45] message-pop ${
                              message.isDeletedForEveryone
                                ? darkMode
                                  ? "bg-slate-800/70 text-slate-400 italic"
                                  : "bg-slate-200/80 text-slate-600 italic"
                                : mine
                                ? darkMode
                                  ? "rounded-br-md bg-gradient-to-br from-[#0da6f2] to-[#0a84c1] text-white shadow-lg shadow-[#0da6f2]/20"
                                  : "rounded-br-md bg-white/90 text-slate-800 shadow-sm"
                                : darkMode
                                  ? "rounded-tl-md bg-slate-800/80 text-slate-100 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                                  : "rounded-tl-md bg-black text-white shadow-[0_10px_30px_rgba(0,0,0,0.15)]"
                            }`}
                          >
                            {message.isDeletedForEveryone ? "This message was deleted" : message.text}
                          </div>
                          <span className={`text-[11px] font-semibold tracking-[0.01em] ${darkMode ? "text-slate-500" : "text-slate-500"}`}>
                            {formatTime(message.createdAt)} {mine ? (isReadByRecipient ? "✓✓" : "✓") : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </div>

              {selectedUser && (
                <footer className="p-3 sm:p-4 md:p-8">
                  <form
                    onSubmit={onSendMessage}
                    className={`mx-auto flex max-w-5xl items-center gap-2.5 rounded-[1.4rem] border px-3.5 py-2.5 shadow-2xl transition-all duration-200 ease-out focus-within:-translate-y-0.5 focus-within:scale-[1.003] sm:gap-3 sm:rounded-[2rem] sm:px-5 sm:py-3 smooth-interactive ${
                      darkMode
                        ? "border-[#0da6f2]/15 bg-[#101c22]/80 shadow-[#0da6f2]/10 focus-within:shadow-[0_16px_40px_rgba(13,166,242,0.20)]"
                        : "border-white bg-white/90 shadow-black/5 focus-within:shadow-[0_16px_35px_rgba(15,23,42,0.14)]"
                    }`}
                  >
                    <input
                      className={`flex-1 border-none bg-transparent py-2 text-sm font-medium placeholder:text-slate-500 transition-all duration-200 focus:outline-none focus:placeholder:opacity-70 ${
                        darkMode ? "text-slate-100 caret-[#0da6f2]" : "text-slate-900 caret-slate-900"
                      }`}
                      placeholder="Write a message..."
                      value={messageText}
                      onChange={(event) => onType(event.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={sendingMessage || !activeUser || !messageText.trim()}
                      className={`group flex h-11 w-11 items-center justify-center rounded-full text-white transition-all duration-200 ease-out enabled:active:scale-95 disabled:opacity-70 ${
                        darkMode
                          ? "bg-[#0da6f2] shadow-lg shadow-[#0da6f2]/30 enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_14px_28px_rgba(13,166,242,0.36)]"
                          : "bg-black enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_12px_22px_rgba(15,23,42,0.25)]"
                      }`}
                    >
                      <span className="transition-transform duration-200 ease-out group-hover:translate-x-0.5">➤</span>
                    </button>
                  </form>
                </footer>
              )}

              {showUserDetails && selectedUser && (
                <>
                  <button
                    type="button"
                    aria-label="Close user details"
                    onClick={closeUserDetailsPanel}
                    className={`absolute inset-0 z-30 bg-black/35 transition-opacity duration-300 ${
                      userDetailsActive ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  <aside
                    className={`absolute right-0 top-0 z-40 flex h-full w-full max-w-sm flex-col border-l px-5 py-6 shadow-2xl transition-all duration-300 ease-out will-change-transform ${
                      userDetailsActive
                        ? "translate-x-0 opacity-100"
                        : "translate-x-10 opacity-0 pointer-events-none"
                    } ${
                      darkMode
                        ? "border-[#0da6f2]/15 bg-[#101c22] text-slate-100"
                        : "border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold">User details</h3>
                      <button
                        type="button"
                        onClick={closeUserDetailsPanel}
                        className={`rounded-lg px-2 py-1 text-sm font-semibold ${
                          darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="mt-6 flex flex-col items-center text-center">
                      <Avatar user={selectedUser} size={92} />
                      <p className={`mt-3 text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{selectedUser.displayName}</p>
                      <p className={`mt-1 text-sm font-medium ${darkMode ? "text-green-400" : "text-slate-600"}`}>
                        {typingUserId === selectedUser.id ? `Typing${".".repeat(typingDots)}` : formatLastSeen(selectedUser)}
                      </p>
                    </div>

                    <div className={`mt-7 space-y-4 border-t pt-5 ${darkMode ? "border-[#0da6f2]/10" : "border-slate-200"}`}>
                      <div>
                        <p className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-slate-500" : "text-slate-500"}`}>About</p>
                        <p className={`mt-1.5 text-sm font-medium leading-6 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                          {selectedUser.about || "No bio available."}
                        </p>
                      </div>

                      <div>
                        <p className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-slate-500" : "text-slate-500"}`}>Email</p>
                        <p className={`mt-1.5 break-all text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{selectedUser.email}</p>
                      </div>
                    </div>
                  </aside>
                </>
              )}
            </main>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <section className={`w-full shrink-0 border-b md:w-80 md:border-b-0 md:border-r ${panelClasses}`}>
              <div className="p-8 pb-4">
                <h2 className={`mb-8 text-2xl font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>Settings</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-1 md:space-y-2 md:gap-0">
                  <button className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-[13px] font-semibold leading-tight sm:text-sm ${darkMode ? "border border-[#0da6f2]/20 bg-[#0da6f2]/10 text-slate-100" : "border border-white/80 bg-white/60 text-slate-900"}`}>
                    <span>👤</span>
                    <span>Profile</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-[13px] font-semibold leading-tight sm:text-sm ${
                      darkMode
                        ? "border border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                        : "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    }`}
                  >
                    <span>↪</span>
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            </section>

            <main className={`custom-scrollbar flex min-w-0 flex-1 flex-col overflow-y-auto ${darkMode ? "bg-[#101c22]/35" : "bg-white/5"}`}>
              <header className="px-4 py-6 md:px-10 md:py-8">
                <h1 className={`text-3xl font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>Edit Profile</h1>
                <p className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Manage your public information and account details.</p>
              </header>

              <div className="max-w-3xl px-4 pb-12 md:px-10">
                <div className="flex flex-col gap-10">
                  <div className="flex flex-col items-center">
                    <label className="group relative cursor-pointer">
                      <div className="h-40 w-40 overflow-hidden rounded-full border-4 border-white shadow-xl">
                        <Avatar user={{ displayName, avatarUrl }} size={160} />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="text-center text-white">
                          <p className="text-sm font-semibold uppercase tracking-wide">Upload</p>
                        </div>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={onAvatarFileSelect} />
                    </label>
                    {avatarError && <p className="mt-2 text-xs font-semibold text-red-600">{avatarError}</p>}
                  </div>

                  <div className="space-y-7">
                    <div className="space-y-2.5">
                      <label htmlFor="profile-display-name" className={`ml-1 text-sm font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Display Name</label>
                      <input
                        id="profile-display-name"
                        className={`w-full rounded-2xl px-6 py-4 text-[15px] font-semibold ${softInputClasses}`}
                        type="text"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2.5 opacity-70">
                      <label htmlFor="profile-email" className={`ml-1 text-sm font-bold ${darkMode ? "text-slate-400" : "text-slate-700"}`}>Email Address</label>
                      <input
                        id="profile-email"
                        className={`w-full cursor-not-allowed rounded-2xl px-6 py-4 text-[15px] font-medium ${darkMode ? "border border-white/10 bg-slate-900/40 text-slate-500" : "border border-white/40 bg-white/20 text-slate-600"}`}
                        type="email"
                        value={me.email}
                        disabled
                      />
                    </div>

                    <div className="space-y-2.5">
                      <label htmlFor="profile-about" className={`ml-1 text-sm font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>About</label>
                      <textarea
                        id="profile-about"
                        className={`w-full resize-none rounded-2xl px-6 py-4 text-[15px] font-medium ${softInputClasses}`}
                        rows={4}
                        value={about}
                        onChange={(event) => setAbout(event.target.value)}
                      />
                      <p className={`ml-1 text-xs ${darkMode ? "text-slate-500" : "text-slate-500"}`}>Brief description for your profile. This is visible to all users.</p>
                    </div>

                    <div className="space-y-2.5">
                      <label htmlFor="profile-avatar-url" className={`ml-1 text-sm font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Avatar URL</label>
                      <input
                        id="profile-avatar-url"
                        className={`w-full rounded-2xl px-6 py-4 text-[15px] font-medium ${softInputClasses}`}
                        value={avatarUrl}
                        onChange={(event) => {
                          setAvatarUrl(event.target.value);
                          setAvatarError("");
                        }}
                        placeholder="https://..."
                      />
                    </div>
                  </div>

                  <div className={`flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-end sm:gap-4 ${darkMode ? "border-[#0da6f2]/10" : "border-white/30"}`}>
                    <button
                      className={`w-full rounded-2xl px-8 py-3.5 text-sm font-bold sm:w-auto ${darkMode ? "text-slate-300 hover:bg-slate-800/40" : "text-slate-600 hover:bg-white/40"}`}
                      onClick={onCancelProfile}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className={`w-full rounded-2xl px-10 py-3.5 text-sm font-bold text-white shadow-lg disabled:opacity-70 sm:w-auto ${darkMode ? "bg-[#0da6f2] shadow-[#0da6f2]/30" : "bg-black shadow-black/20"}`}
                      onClick={onSaveProfile}
                      disabled={profileSaving}
                      type="button"
                    >
                      {profileSaving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
              </div>
            </main>
          </div>
        )}
      </div>

      {messageMenu && (
        <div
          role="button"
          tabIndex={-1}
          aria-label="Close menu"
          className="fixed inset-0 z-50"
          onClick={() => setMessageMenu(null)}
          onKeyDown={(event) => { if (event.key === "Escape") setMessageMenu(null); }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMessageMenu(null);
          }}
        >
          <div
            role="menu"
            className={`fixed min-w-[185px] rounded-xl border p-1.5 shadow-xl fade-in-soft ${
              darkMode
                ? "border-[#0da6f2]/20 bg-slate-900/95"
                : "border-slate-200 bg-white"
            }`}
            style={{ left: messageMenu.x, top: messageMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              disabled={deletingMessage}
              onClick={() => {
                setPendingDeleteMessage(messageMenu.message);
                setMessageMenu(null);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold disabled:opacity-60 ${
                darkMode
                  ? "text-slate-200 hover:bg-slate-700/60"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {pendingDeleteMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 fade-in-soft">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
              darkMode
                ? "border-[#0da6f2]/20 bg-[#101c22] text-slate-100"
                : "border-slate-200 bg-white text-slate-900"
            } slide-in-right`}
          >
            <h3 className="text-base font-bold">Delete message</h3>
            <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Choose how you want to delete this message.
            </p>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={deletingMessage}
                onClick={() => void onDeleteMessage("me")}
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                  darkMode
                    ? "bg-slate-800 text-slate-100 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                }`}
              >
                {deletingMessage ? "Deleting..." : "Delete for me"}
              </button>
              <button
                type="button"
                disabled={
                  deletingMessage ||
                  pendingDeleteMessage.senderId !== me?.id ||
                  pendingDeleteMessage.isDeletedForEveryone
                }
                onClick={() => void onDeleteMessage("everyone")}
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                  darkMode
                    ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                }`}
              >
                {deletingMessage ? "Deleting..." : "Delete for everyone"}
              </button>
            </div>

            <button
              type="button"
              disabled={deletingMessage}
              onClick={() => setPendingDeleteMessage(null)}
              className={`mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${
                darkMode
                  ? "text-slate-300 hover:bg-slate-800/70"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingDeleteConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 fade-in-soft">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
              darkMode
                ? "border-[#0da6f2]/20 bg-[#101c22] text-slate-100"
                : "border-slate-200 bg-white text-slate-900"
            } slide-in-right`}
          >
            <h3 className="text-base font-bold">Delete chat</h3>
            <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Delete chat with {pendingDeleteConversation.user.displayName} for you?
            </p>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={deletingChat}
                onClick={() => void onDeleteConversationFromList("me")}
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                  darkMode
                    ? "bg-slate-800 text-slate-100 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                }`}
              >
                {deletingChat ? "Deleting..." : "Delete"}
              </button>
            </div>

            <button
              type="button"
              disabled={deletingChat}
              onClick={() => setPendingDeleteConversation(null)}
              className={`mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${
                darkMode
                  ? "text-slate-300 hover:bg-slate-800/70"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mx-auto mt-3 max-w-[1400px] rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </main>
  );
}
