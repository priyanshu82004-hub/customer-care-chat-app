
import { WebSocket } from "ws";

export type ConnectedUser = {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "AGENT";
};

export class ConnectionManager {
  private connections = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket) {
    let userConnections = this.connections.get(userId);

    if (!userConnections) {
      userConnections = new Set<WebSocket>();
      this.connections.set(userId, userConnections);
    }

    userConnections.add(socket);

    console.log("Connection registered:", {
      userId,
      totalConnections: userConnections.size,
      totalConnectedUsers: this.connections.size,
    });
  }

  remove(userId: string, socket: WebSocket) {
    const userConnections = this.connections.get(userId);

    if (!userConnections) {
      console.warn("Cannot remove connection: user not registered", {
        userId,
      });
      return;
    }

    userConnections.delete(socket);

    if (userConnections.size === 0) {
      this.connections.delete(userId);
    }

    console.log("Connection removed:", {
      userId,
      remainingConnections: userConnections.size,
      totalConnectedUsers: this.connections.size,
    });
  }

  sendToUser(userId: string, payload: unknown) {
    const userConnections = this.connections.get(userId);

    if (!userConnections || userConnections.size === 0) {
      console.warn("No WebSocket connections for user:", userId);
      return;
    }

    const message = JSON.stringify(payload);

    console.log("Sending event to user:", {
      userId,
      connections: userConnections.size,
    });

    for (const socket of userConnections) {
      if (socket.readyState !== WebSocket.OPEN) {
        console.warn("User socket is not OPEN:", {
          userId,
          readyState: socket.readyState,
        });
        continue;
      }

      socket.send(message, (error) => {
        if (error) {
          console.error("Failed to send WebSocket event:", {
            userId,
            error,
          });
          return;
        }

        console.log("WebSocket event sent:", {
          userId,
          eventType:
            typeof payload === "object" &&
            payload !== null &&
            "type" in payload
              ? payload.type
              : "UNKNOWN",
        });
      });
    }
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }
}

export const connectionManager = new ConnectionManager();
