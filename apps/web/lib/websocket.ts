
"use client";

export type WebSocketEvent =
  | {
      type: "CONNECTED";
      userId: string;
      role: "CUSTOMER" | "AGENT";
    }
  | {
      type: "MESSAGE_SENT";
      messageId: string;
      conversationId: string;
      createdAt: string;
    }
  | {
      type: "NEW_MESSAGE";
      message: {
        id: string;
        conversationId: string;
        senderId: string;
        content: string;
        messageType: "TEXT" | "IMAGE" | "FILE" | "SYSTEM";
        createdAt: string;
      };
    }
  | {
      type: "ERROR";
      message: string;
    };

type WebSocketOptions = {
  onEvent: (event: WebSocketEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
};

export class ChatWebSocket {
  private socket: WebSocket | null = null;

  constructor(private options: WebSocketOptions) {}

  connect() {
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const url = process.env.NEXT_PUBLIC_WS_URL;

    if (!url) {
      throw new Error("NEXT_PUBLIC_WS_URL is not configured");
    }

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.options.onOpen?.();
    };

    this.socket.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data);

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "type" in parsed &&
          typeof parsed.type === "string"
        ) {
          this.options.onEvent(parsed as WebSocketEvent);
        }
      } catch {
        console.error("Received invalid WebSocket JSON");
      }
    };

    this.socket.onclose = () => {
      this.options.onClose?.();
    };

    this.socket.onerror = () => {
      this.options.onError?.();
    };
  }

  sendMessage(conversationId: string, content: string) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    this.socket.send(
      JSON.stringify({
        type: "SEND_MESSAGE",
        conversationId,
        content,
      })
    );
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
  }
}
