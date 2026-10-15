"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type User = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "AGENT";
};

type Conversation = {
  id: string;
  title: string | null;
  status: string;
  createdById: string;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
};

type Attachment = {
  id: string;
  url: string;
  fileName: string;
  fileType: string;
};

type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  attachments?: Attachment[];
};

type WSEvent = {
  type?: string;
  message?: Partial<ChatMessage>;
  messageId?: string;
  conversationId?: string;
  createdAt?: string;
  message?: Partial<ChatMessage>;
  error?: string;
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export default function AgentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [filter, setFilter] = useState<
    "ALL" | "UNASSIGNED" | "MINE"
  >("ALL");

  const socketRef = useRef<WebSocket | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const pendingConversationRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ??
    null;

  const updateMessages = useCallback(
    (updater: (previous: ChatMessage[]) => ChatMessage[]) => {
      setMessages((previous) => {
        const next = updater(previous);
        messagesRef.current = next;
        return next;
      });
    },
    []
  );

  const appendMessage = useCallback(
    (incoming: ChatMessage) => {
      updateMessages((previous) => {
        if (previous.some((message) => message.id === incoming.id)) {
          return previous;
        }

        return [...previous, incoming].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime()
        );
      });
    },
    [updateMessages]
  );

  const request = useCallback(
    async (url: string, init?: RequestInit) => {
      const response = await fetch(url, {
        ...init,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...(init?.body
            ? { "Content-Type": "application/json" }
            : {}),
          ...init?.headers,
        },
      });

      if (response.status === 401) {
        window.location.replace("/login");
        throw new Error("Your session has expired. Please log in again.");
      }

      return response;
    },
    []
  );

  const loadConversations = useCallback(async () => {
    const response = await request("/api/conversations");
    const payload = await readJson(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load conversations");
    }

    setConversations(payload.conversations ?? []);
  }, [request]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setMessagesLoading(true);
      setError("");

      try {
        const response = await request(
          `/api/conversations/${conversationId}/messages?limit=50`
        );
        const payload = await readJson(response);

        if (!response.ok) {
          throw new Error(
            payload.error ?? "Unable to load messages"
          );
        }

        const history: ChatMessage[] = payload.messages ?? [];

        updateMessages((previous) => {
          const merged = new Map<string, ChatMessage>();

          for (const message of history) {
            merged.set(message.id, message);
          }

          // Preserve real-time messages received during the history request.
          for (const message of previous) {
            if (message.conversationId === conversationId) {
              merged.set(message.id, message);
            }
          }

          return Array.from(merged.values()).sort(
            (a, b) =>
              new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()
          );
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unable to load messages"
        );
      } finally {
        setMessagesLoading(false);
      }
    },
    [request, updateMessages]
  );

  const initialize = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await request("/api/auth/me");
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to verify your account");
      }

      const currentUser =
        payload.user ?? payload.data?.user ?? payload.data ?? payload;

      if (currentUser.role !== "AGENT") {
        window.location.replace("/");
        return;
      }

      setUser(currentUser);
      await loadConversations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, [loadConversations, request]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Establish the agent's authenticated WebSocket connection.
  useEffect(() => {
    if (!user?.id) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

    if (!wsUrl) {
      setError("NEXT_PUBLIC_WS_URL is not configured.");
      return;
    }

    let disposed = false;
    const socket = new WebSocket(wsUrl);

    socketRef.current = socket;

    socket.onopen = () => {
      if (disposed) return;

      console.log("Agent WebSocket connected");
      setWsConnected(true);
    };

    socket.onmessage = (event) => {
      let payload: WSEvent;

      try {
        payload = JSON.parse(event.data);
      } catch {
        console.error("Invalid WebSocket event received");
        return;
      }

      if (payload.type === "CONNECTED") {
        console.log("Agent authenticated with WebSocket server");
        return;
      }

      if (payload.type === "MESSAGE_SENT") {
        if (
          payload.conversationId === pendingConversationRef.current
        ) {
          pendingConversationRef.current = null;
          setBusy(false);
          setDraft("");
        }

        return;
      }

      if (payload.type === "ERROR") {
        pendingConversationRef.current = null;
        setBusy(false);
        setError(
          payload.message ?? payload.error ?? "Unable to send message."
        );
        return;
      }

      if (payload.type !== "NEW_MESSAGE" || !payload.message) {
        return;
      }

      const raw = payload.message;

      if (
        typeof raw.id !== "string" ||
        typeof raw.conversationId !== "string" ||
        typeof raw.senderId !== "string" ||
        typeof raw.content !== "string" ||
        typeof raw.createdAt !== "string"
      ) {
        console.error("Invalid NEW_MESSAGE payload:", payload);
        return;
      }

      const incoming: ChatMessage = {
        id: raw.id,
        conversationId: raw.conversationId,
        senderId: raw.senderId,
        content: raw.content,
        messageType: raw.messageType ?? "TEXT",
        isEdited: raw.isEdited ?? false,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt ?? raw.createdAt,
        attachments: raw.attachments ?? [],
      };

      console.log("Agent received NEW_MESSAGE:", incoming);

      if (activeIdRef.current === incoming.conversationId) {
        appendMessage(incoming);
      }

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === incoming.conversationId
            ? {
                ...conversation,
                updatedAt: incoming.createdAt,
                _count: {
                  messages:
                    (conversation._count?.messages ?? 0) + 1,
                },
              }
            : conversation
        )
      );
    };

    socket.onerror = (event) => {
      console.error("Agent WebSocket error:", event);
    };

    socket.onclose = () => {
      if (disposed) return;

      console.log("Agent WebSocket disconnected");
      setWsConnected(false);

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      pendingConversationRef.current = null;
      setBusy(false);
    };

    return () => {
      disposed = true;

      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      socket.close();
    };
  }, [user?.id, appendMessage]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function selectConversation(conversation: Conversation) {
    setActiveId(conversation.id);
    activeIdRef.current = conversation.id;
    setMessages([]);
    messagesRef.current = [];
    setError("");

    if (conversation.assignedToId !== user?.id) {
      return;
    }

    await loadMessages(conversation.id);
  }

  async function claimConversation(conversation: Conversation) {
    setBusy(true);
    setError("");

    try {
      const response = await request(
        `/api/conversations/${conversation.id}/assign`,
        { method: "POST" }
      );

      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to claim conversation");
      }

      await loadConversations();

      const claimed = payload.conversation as Conversation;

      setActiveId(claimed.id);
      activeIdRef.current = claimed.id;

      await loadMessages(claimed.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to claim conversation"
      );

      await loadConversations().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeConversation || !draft.trim() || busy) return;

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError(
        "Real-time connection is unavailable. Please try again when connected."
      );
      return;
    }

    setBusy(true);
    setError("");
    pendingConversationRef.current = activeConversation.id;

    try {
      socket.send(
        JSON.stringify({
          type: "SEND_MESSAGE",
          conversationId: activeConversation.id,
          content: draft.trim(),
        })
      );
    } catch (err) {
      pendingConversationRef.current = null;
      setBusy(false);
      setError(
        err instanceof Error ? err.message : "Unable to send message"
      );
    }
  }

  async function updateStatus(status: "RESOLVED" | "CLOSED") {
    if (!activeConversation || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await request(
        `/api/conversations/${activeConversation.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }
      );

      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update status");
      }

      await loadConversations();

      setActiveId(null);
      activeIdRef.current = null;
      setMessages([]);
      messagesRef.current = [];
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update status"
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);

    try {
      const response = await request("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        const payload = await readJson(response);
        throw new Error(payload.error ?? "Unable to log out");
      }

      window.location.replace("/login");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to log out"
      );
      setBusy(false);
    }
  }

  const visibleConversations = conversations.filter((conversation) => {
    if (filter === "UNASSIGNED") {
      return (
        conversation.status === "OPEN" &&
        conversation.assignedToId === null
      );
    }

    if (filter === "MINE") {
      return conversation.assignedToId === user?.id;
    }

    return true;
  });

  const openCount = conversations.filter(
    (conversation) =>
      conversation.status === "OPEN" ||
      conversation.status === "IN_PROGRESS"
  ).length;

  const mineCount = conversations.filter(
    (conversation) => conversation.assignedToId === user?.id
  ).length;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        Loading agent dashboard...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-5 py-4 sm:px-8">
        <div>
          <h1 className="text-xl font-bold">Support Inbox</h1>
          <p className="text-sm text-slate-500">
            Manage customer conversations
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-slate-500">Support agent</p>
            <p
              className={`text-xs ${
                wsConnected ? "text-green-700" : "text-red-600"
              }`}
            >
              {wsConnected ? "Real-time connected" : "Disconnected"}
            </p>
          </div>

          <button
            onClick={logout}
            disabled={busy}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-sm text-slate-500">Active conversations</p>
            <p className="mt-1 text-2xl font-bold">{openCount}</p>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <p className="text-sm text-slate-500">Assigned to me</p>
            <p className="mt-1 text-2xl font-bold">{mineCount}</p>
          </div>

          <div className="col-span-2 rounded-xl border bg-white p-4 sm:col-span-1">
            <p className="text-sm text-slate-500">Unassigned</p>
            <p className="mt-1 text-2xl font-bold">
              {
                conversations.filter(
                  (conversation) =>
                    conversation.status === "OPEN" &&
                    conversation.assignedToId === null
                ).length
              }
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="grid min-h-[65vh] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b p-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["ALL", "All"],
                    ["UNASSIGNED", "Unassigned"],
                    ["MINE", "My conversations"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      filter === value
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => void loadConversations()}
                className="mt-3 text-sm text-blue-700 hover:underline"
              >
                Refresh inbox
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto">
              {visibleConversations.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No conversations in this view.
                </p>
              ) : (
                visibleConversations.map((conversation) => {
                  const isMine = conversation.assignedToId === user?.id;
                  const isSelected = activeId === conversation.id;

                  return (
                    <button
                      key={conversation.id}
                      onClick={() => void selectConversation(conversation)}
                      className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${
                        isSelected ? "bg-blue-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium">
                          {conversation.title || "Customer conversation"}
                        </p>

                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs">
                          {conversation.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-xs text-slate-500">
                        Customer ID: {conversation.createdById}
                      </p>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          {conversation._count?.messages ?? 0} messages
                        </span>

                        <span
                          className={`text-xs font-medium ${
                            isMine ? "text-green-700" : "text-amber-700"
                          }`}
                        >
                          {isMine ? "Assigned to you" : "Unassigned"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border bg-white">
            {!activeConversation ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <h2 className="text-lg font-semibold">
                    Select a conversation
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Choose a conversation from your inbox to view or reply.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div>
                    <h2 className="font-semibold">
                      {activeConversation.title || "Customer conversation"}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Status: {activeConversation.status.replaceAll("_", " ")}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {activeConversation.assignedToId === null &&
                      activeConversation.status === "OPEN" && (
                        <button
                          onClick={() =>
                            void claimConversation(activeConversation)
                          }
                          disabled={busy}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Take conversation
                        </button>
                      )}

                    {activeConversation.assignedToId === user?.id &&
                      !["RESOLVED", "CLOSED"].includes(
                        activeConversation.status
                      ) && (
                        <>
                          <button
                            onClick={() => void updateStatus("RESOLVED")}
                            disabled={busy}
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                          >
                            Resolve
                          </button>

                          <button
                            onClick={() => void updateStatus("CLOSED")}
                            disabled={busy}
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                          >
                            Close
                          </button>
                        </>
                      )}
                  </div>
                </div>

                {activeConversation.assignedToId !== user?.id ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <p className="text-slate-600">
                      Claim this conversation before reading its messages.
                    </p>

                    {activeConversation.status === "OPEN" &&
                      activeConversation.assignedToId === null && (
                        <button
                          onClick={() =>
                            void claimConversation(activeConversation)
                          }
                          disabled={busy}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Take conversation
                        </button>
                      )}
                  </div>
                ) : (
                  <>
                    <div
                      ref={messageListRef}
                      className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4"
                    >
                      {messagesLoading ? (
                        <p className="text-sm text-slate-500">
                          Loading messages...
                        </p>
                      ) : messages.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No messages yet.
                        </p>
                      ) : (
                        messages.map((message) => {
                          const isAgent = message.senderId === user?.id;

                          return (
                            <div
                              key={message.id}
                              className={`flex ${
                                isAgent ? "justify-end" : "justify-start"
                              }`}
                            >
                              <div
                                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                                  isAgent
                                    ? "bg-blue-600 text-white"
                                    : "border bg-white text-slate-900"
                                }`}
                              >
                                <p className="mb-1 text-xs opacity-75">
                                  {isAgent ? "You" : "Customer"}
                                  {" · "}
                                  {new Date(
                                    message.createdAt
                                  ).toLocaleString()}
                                </p>

                                <p className="whitespace-pre-wrap break-words text-sm">
                                  {message.content}
                                </p>

                                {message.attachments?.map((attachment) => (
                                  <a
                                    key={attachment.id}
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 block text-sm underline"
                                  >
                                    {attachment.fileName}
                                  </a>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form
                      onSubmit={sendMessage}
                      className="flex gap-2 border-t bg-white p-4"
                    >
                      <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Reply to customer..."
                        maxLength={5000}
                        disabled={
                          busy ||
                          !wsConnected ||
                          ["RESOLVED", "CLOSED"].includes(
                            activeConversation.status
                          )
                        }
                        className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />

                      <button
                        type="submit"
                        disabled={
                          busy ||
                          !wsConnected ||
                          !draft.trim() ||
                          ["RESOLVED", "CLOSED"].includes(
                            activeConversation.status
                          )
                        }
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Send
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}