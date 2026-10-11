
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
  }

  remove(userId: string, socket: WebSocket) {
    const userConnections = this.connections.get(userId);

    if (!userConnections) return;

    userConnections.delete(socket);

    if (userConnections.size === 0) {
      this.connections.delete(userId);
    }
  }

  sendToUser(userId: string, payload: unknown) {
    const userConnections = this.connections.get(userId);

    if (!userConnections) return;

    const message = JSON.stringify(payload);

    for (const socket of userConnections) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }
}

export const connectionManager = new ConnectionManager();
