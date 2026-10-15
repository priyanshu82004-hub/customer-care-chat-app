
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { prisma } from "@repo/db/clients";
import { connectionManager } from "./connection-manager.js";

const PORT = Number(process.env.WS_PORT ?? 8080);

const WEB_APP_URL =
  process.env.WEB_APP_URL ?? "http://localhost:3000";

const allowedOrigins = new Set(
  (
    process.env.WS_ALLOWED_ORIGINS ??
    "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "AGENT";
};

const sendMessageSchema = z.object({
  type: z.literal("SEND_MESSAGE"),
  conversationId: z.string().min(1),
  content: z.string().trim().min(1).max(5000),
});

const socketUsers = new WeakMap<WebSocket, AuthenticatedUser>();

const server = createServer();
const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string
) {
  if (!socket.destroyed) {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\n` +
        "Connection: close\r\n\r\n"
    );
    socket.destroy();
  }
}

function sendEvent(socket: WebSocket, event: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
    return true;
  }

  console.warn("Cannot send event: WebSocket is not OPEN", {
    readyState: socket.readyState,
    event,
  });

  return false;
}

async function authenticateRequest(
  cookie: string
): Promise<AuthenticatedUser | null> {
  const authUrl = new URL("/api/auth/me", WEB_APP_URL);

  const response = await fetch(authUrl, {
    method: "GET",
    headers: { cookie },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) return null;

  const result: unknown = await response.json();

  if (
    typeof result !== "object" ||
    result === null ||
    !("user" in result)
  ) {
    return null;
  }

  const user = result.user;

  if (
    typeof user !== "object" ||
    user === null ||
    !("id" in user) ||
    !("name" in user) ||
    !("email" in user) ||
    !("role" in user) ||
    typeof user.id !== "string" ||
    typeof user.name !== "string" ||
    typeof user.email !== "string" ||
    (user.role !== "CUSTOMER" && user.role !== "AGENT")
  ) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

server.on("upgrade", async (request, socket, head) => {
  const origin = request.headers.origin;

  if (!origin || !allowedOrigins.has(origin)) {
    console.warn("WebSocket upgrade rejected: invalid origin", origin);
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  const cookie = request.headers.cookie;

  if (!cookie) {
    console.warn("WebSocket upgrade rejected: missing cookie");
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  let user: AuthenticatedUser | null;

  try {
    user = await authenticateRequest(cookie);
  } catch (error) {
    console.error("Session validation service failed:", error);
    rejectUpgrade(socket, 503, "Service Unavailable");
    return;
  }

  if (!user) {
    console.warn("WebSocket upgrade rejected: unauthenticated user");
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  if (socket.destroyed) return;

  wss.handleUpgrade(request, socket, head, (ws) => {
    socketUsers.set(ws, user);
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (socket) => {
  const user = socketUsers.get(socket);

  if (!user) {
    socket.close(1008, "Authentication required");
    return;
  }

  connectionManager.add(user.id, socket);

  console.log("WebSocket connected:", {
    userId: user.id,
    role: user.role,
  });

  sendEvent(socket, {
    type: "CONNECTED",
    userId: user.id,
    role: user.role,
  });

  socket.on("message", async (data) => {
    console.log("RAW WS MESSAGE:", data.toString());

    let payload: unknown;

    try {
      payload = JSON.parse(data.toString());
    } catch {
      console.warn("Invalid JSON received from:", user.id);

      sendEvent(socket, {
        type: "ERROR",
        message: "Invalid JSON",
      });
      return;
    }

    const result = sendMessageSchema.safeParse(payload);

    if (!result.success) {
      console.warn("Invalid WebSocket event:", result.error.flatten());

      sendEvent(socket, {
        type: "ERROR",
        message: "Invalid message event",
      });
      return;
    }

    const { conversationId, content } = result.data;

    console.log("Validated SEND_MESSAGE:", {
      userId: user.id,
      role: user.role,
      conversationId,
    });

    try {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          ...(user.role === "CUSTOMER"
            ? { createdById: user.id }
            : { assignedToId: user.id }),
          status: {
            in: ["OPEN", "IN_PROGRESS"],
          },
        },
        select: {
          id: true,
          createdById: true,
          assignedToId: true,
        },
      });

      if (!conversation) {
        console.warn("Conversation not found or access denied:", {
          userId: user.id,
          role: user.role,
          conversationId,
        });

        sendEvent(socket, {
          type: "ERROR",
          message: "Conversation not found or access denied",
        });
        return;
      }

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          content,
          messageType: "TEXT",
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          messageType: true,
          createdAt: true,
        },
      });

      console.log("Message saved:", {
        messageId: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
      });

      // Confirm persistence to the sending connection.
      sendEvent(socket, {
        type: "MESSAGE_SENT",
        messageId: message.id,
        conversationId: message.conversationId,
        createdAt: message.createdAt,
      });

      // Deliver the persisted message to the customer.
      console.log("Broadcasting NEW_MESSAGE to customer:", {
        customerId: conversation.createdById,
        messageId: message.id,
      });

      connectionManager.sendToUser(conversation.createdById, {
        type: "NEW_MESSAGE",
        message,
      });

      // Deliver to the assigned agent, if one exists.
      if (conversation.assignedToId) {
        console.log("Broadcasting NEW_MESSAGE to agent:", {
          agentId: conversation.assignedToId,
          messageId: message.id,
        });

        connectionManager.sendToUser(conversation.assignedToId, {
          type: "NEW_MESSAGE",
          message,
        });
      } else {
        console.warn("No agent assigned to conversation:", conversation.id);
      }
    } catch (error) {
      console.error("WebSocket message failed:", error);

      sendEvent(socket, {
        type: "ERROR",
        message: "Unable to send message",
      });
    }
  });

  socket.on("close", (code, reason) => {
    connectionManager.remove(user.id, socket);

    console.log("WebSocket disconnected:", {
      userId: user.id,
      role: user.role,
      code,
      reason: reason.toString(),
    });
  });

  socket.on("error", (error) => {
    console.error(`WebSocket error for ${user.id}:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("HTTP server error:", error);
});