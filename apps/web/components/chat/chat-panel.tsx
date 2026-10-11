
"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useChatWebSocket } from "@/hooks/use-chat-websocket";

type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: "TEXT" | "IMAGE" | "FILE" | "SYSTEM";
  createdAt: string;
};

type ChatPanelProps = {
  conversationId: string;
};

export function ChatPanel({ conversationId }: ChatPanelProps) {
  const { isConnected, events, sendMessage } = useChatWebSocket();

  const [content, setContent] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/messages?limit=50`
      );

      const data: unknown = await response.json();

      if (!response.ok) {
        throw new Error("Could not load conversation messages.");
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("messages" in data) ||
        !Array.isArray(data.messages)
      ) {
        throw new Error("Invalid message history response.");
      }

      setMessages(data.messages as ChatMessage[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load messages."
      );
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const incomingMessages = events
      .filter(
        (event) =>
          event.type === "NEW_MESSAGE" &&
          event.message.conversationId === conversationId
      )
      .map((event) => event.message);

    if (incomingMessages.length === 0) return;

    setMessages((previous) => {
      const byId = new Map(previous.map((message) => [message.id, message]));

      for (const message of incomingMessages) {
        byId.set(message.id, message);
      }

      return Array.from(byId.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() -
          new Date(b.createdAt).getTime()
      );
    });
  }, [events, conversationId]);

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedContent = content.trim();

    if (!trimmedContent) return;

    try {
      sendMessage(conversationId, trimmedContent);
      setContent("");
    } catch {
      setError("WebSocket is not connected. Please try again.");
    }
  }

  return (
    <section className="flex h-[500px] flex-col rounded-xl border">
      <header className="flex items-center justify-between border-b p-4">
        <h2 className="font-semibold">Customer Support</h2>
        <span className="text-sm text-muted-foreground">
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            Loading messages...
          </p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className="max-w-[80%] rounded-lg bg-muted p-3"
            >
              <p>{message.content}</p>
              <time className="mt-1 block text-xs text-muted-foreground">
                {new Date(message.createdAt).toLocaleTimeString()}
              </time>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSendMessage} className="flex gap-2 border-t p-3">
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Type your message..."
          maxLength={5000}
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
        />

        <button
          type="submit"
          disabled={!isConnected || !content.trim()}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {error && (
        <p role="alert" className="px-3 pb-3 text-sm text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
