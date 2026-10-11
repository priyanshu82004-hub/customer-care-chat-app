
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatWebSocket,
  type WebSocketEvent,
} from "@/lib/websocket";

export function useChatWebSocket() {
  const clientRef = useRef<ChatWebSocket | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);

  useEffect(() => {
    const client = new ChatWebSocket({
      onEvent(event) {
        setEvents((previous) => [...previous, event]);
      },
      onOpen() {
        setIsConnected(true);
      },
      onClose() {
        setIsConnected(false);
      },
      onError() {
        setIsConnected(false);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const sendMessage = useCallback(
    (conversationId: string, content: string) => {
      clientRef.current?.sendMessage(conversationId, content);
    },
    []
  );

  return {
    isConnected,
    events,
    sendMessage,
  };
}
