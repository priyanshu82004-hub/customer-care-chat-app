
import { NextResponse } from "next/server";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireRole } from "@/lib/auth/authorization";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const user = requireRole(
      await getCurrentUser(),
      ["AGENT"]
    );

    const { id: conversationId } = await params;

    // Claim only an open, unassigned conversation.
    const result = await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        status: "OPEN",
        assignedToId: null,
      },
      data: {
        assignedToId: user.id,
        status: "IN_PROGRESS",
      },
    });

    if (result.count === 0) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          status: true,
          assignedToId: true,
        },
      });

      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: "Conversation is already assigned or not open" },
        { status: 409 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Conversation assigned successfully",
        conversation,
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
        { error: "Only agents can claim conversations" },
        { status: 403 }
      );
    }

    console.error("Assign conversation failed:", error);

    return NextResponse.json(
      { error: "Unable to assign conversation" },
      { status: 500 }
    );
  }
}
