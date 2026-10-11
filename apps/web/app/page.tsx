
"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

type Conversation = {
  id: string;
  title: string | null;
  status: string;
  createdById: string;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
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
};

type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "AGENT";
};

export default function Home() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ??
    null;

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    setError("");

    try {
      const meResponse = await fetch("/api/auth/me", {
        cache: "no-store",
      });

      if (meResponse.status === 401) {
        window.location.replace("/login");
        return;
      }

      if (!meResponse.ok) {
        throw new Error("Unable to verify your session.");
      }

      const meData = await meResponse.json();
      setUser(meData.user);

      const response = await fetch("/api/conversations", {
        cache: "no-store",
      });

      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Unable to load conversations."
        );
      }

      const items: Conversation[] = data.conversations ?? [];
      setConversations(items);

      setActiveId((previous) => {
        if (previous && items.some((item) => item.id === previous)) {
          return previous;
        }

        return items[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load conversations."
      );
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setError("");

    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/messages?limit=50`,
        { cache: "no-store" }
      );

      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Unable to load messages."
        );
      }

      setMessages(data.messages ?? []);
    } catch (err) {
      setMessages([]);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load messages."
      );
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (activeId) {
      void loadMessages(activeId);
    } else {
      setMessages([]);
    }
  }, [activeId, loadMessages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || !activeId || sending) return;

    setSending(true);
    setError("");

    try {
      const response = await fetch(
        `/api/conversations/${activeId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );

      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Unable to send message."
        );
      }

      const sentMessage: ChatMessage = data.data;

      setMessages((previous) => {
        if (previous.some((message) => message.id === sentMessage.id)) {
          return previous;
        }

        return [...previous, sentMessage];
      });

      setDraft("");
      void loadConversations();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to send message."
      );
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to log out. Please try again.");
      }

      window.location.replace("/login");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to log out. Please try again."
      );
      setLoggingOut(false);
    }
  }

  const filteredConversations = conversations.filter((conversation) =>
    (conversation.title ?? "New conversation")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  async function createConversation() {
    setError("");

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New conversation" }),
      });

      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Unable to create conversation."
        );
      }

      await loadConversations();
      setActiveId(data.conversation.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create conversation."
      );
    }
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-slate-100 text-slate-900">
      <aside className="hidden w-16 shrink-0 flex-col items-center bg-slate-950 py-5 text-white sm:flex">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold">
          C
        </div>

        <div className="mt-8 rounded-xl bg-slate-800 p-3" title="Inbox">
          ✉
        </div>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          title="Log out"
          aria-label="Log out"
          className="mt-auto rounded-xl p-3 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {loggingOut ? "…" : "↪"}
        </button>
      </aside>

      <section className="flex w-full shrink-0 flex-col border-r border-slate-200 bg-white sm:w-72 lg:w-80">
        <header className="border-b border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">
            Customer Care
          </p>

          <div className="mt-1 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Inbox</h1>

            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
              {conversations.length}
            </span>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
        </header>

        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <p className="p-5 text-sm text-slate-500">
              Loading conversations…
            </p>
          ) : filteredConversations.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-slate-500">
                {search
                  ? "No matching conversations."
                  : "No conversations yet."}
              </p>

              {user?.role === "CUSTOMER" && !search && (
                <button
                  type="button"
                  onClick={createConversation}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  Start a conversation
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => setActiveId(conversation.id)}
                className={`w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${
                  activeId === conversation.id ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">
                    {conversation.title || "New conversation"}
                  </p>

                  <span className="text-xs text-slate-400">
                    {conversation._count.messages}
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {conversation.status}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Updated{" "}
                  {new Date(conversation.updatedAt).toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-semibold">
            {user?.name ?? "Guest"}
          </p>

          <p className="truncate text-xs text-slate-500">
            {user?.email ?? "Not signed in"}
          </p>

          <p className="mt-1 text-xs text-blue-600">
            {user?.role ?? ""}
          </p>

          {/* Visible on desktop and mobile */}
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="mt-3 w-full rounded-lg border border-slate-200 px-4 py-2 text-left text-sm font-medium text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loggingOut ? "Logging out…" : "↪  Log out"}
          </button>
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">
              {activeConversation?.title ?? "Select a conversation"}
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              {activeConversation
                ? `Status: ${activeConversation.status}`
                : "Choose a conversation or start a new one"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadConversations()}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700"
          >
            {error}
            {(error.toLowerCase().includes("log in") ||
              error.toLowerCase().includes("authenticated")) && (
              <a className="ml-2 font-semibold underline" href="/login">
                Go to login
              </a>
            )}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-5 md:p-8">
          {loadingMessages ? (
            <p className="text-sm text-slate-500">Loading messages…</p>
          ) : !activeConversation ? (
            <div className="flex h-full items-center justify-center text-center text-slate-500">
              <div>
                <div className="text-4xl">✉</div>
                <p className="mt-3 font-medium">
                  Your conversations appear here
                </p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-slate-400">
              No messages yet. Send the first message below.
            </p>
          ) : (
            messages.map((message) => {
              const mine = message.senderId === user?.id;

              return (
                <div
                  key={message.id}
                  className={`flex ${
                    mine ? "justify-end" : "justify-start"
                  }`}
                >
                  <div className="max-w-[85%] md:max-w-[65%]">
                    <div
                      className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
                        mine
                          ? "rounded-br-md bg-blue-600 text-white"
                          : "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      {message.content}
                    </div>

                    <p
                      className={`mt-1 text-xs text-slate-400 ${
                        mine ? "text-right" : ""
                      }`}
                    >
                      {new Date(message.createdAt).toLocaleString()}
                      {message.isEdited ? " · edited" : ""}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form
          onSubmit={sendMessage}
          className="border-t border-slate-200 bg-white p-4 md:p-6"
        >
          <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-400">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={5000}
              disabled={
                !activeConversation ||
                sending ||
                activeConversation.status === "CLOSED" ||
                activeConversation.status === "RESOLVED"
              }
              placeholder={
                !activeConversation
                  ? "Select a conversation first"
                  : activeConversation.status === "CLOSED" ||
                      activeConversation.status === "RESOLVED"
                    ? "This conversation is closed"
                    : "Write a message…"
              }
              aria-label="Message"
              className="max-h-32 min-h-12 flex-1 resize-y bg-transparent px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={
                !draft.trim() ||
                !activeConversation ||
                sending ||
                activeConversation.status === "CLOSED" ||
                activeConversation.status === "RESOLVED"
              }
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>

          <p className="mt-2 px-1 text-xs text-slate-400">
            Enter to send · Shift + Enter for a new line
          </p>
        </form>
      </section>
    </main>
  );
}
