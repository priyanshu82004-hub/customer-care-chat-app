
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireRole } from "@/lib/auth/authorization";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const statusSchema = z.object({
  status: z.enum(["RESOLVED", "CLOSED"]),
});

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  try {
    const agent = requireRole(
      await getCurrentUser(),
      ["AGENT"]
    );

    const { id } = await params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const result = statusSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Status must be RESOLVED or CLOSED" },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        assignedToId: agent.id,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (
      conversation.status === "CLOSED" ||
      conversation.status === "RESOLVED"
    ) {
      return NextResponse.json(
        { error: "Conversation is already resolved or closed" },
        { status: 409 }
      );
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: result.data.status,
        ...(result.data.status === "RESOLVED"
          ? { resolvedAt: new Date() }
          : {}),
      },
      select: {
        id: true,
        status: true,
        assignedToId: true,
        resolvedAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Conversation status updated successfully",
        conversation: updatedConversation,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Only agents can update conversation status" },
        { status: 403 }
      );
    }

    console.error("Update conversation status failed:", error);

    return NextResponse.json(
      { error: "Unable to update conversation status" },
      { status: 500 }
    );
  }
}
