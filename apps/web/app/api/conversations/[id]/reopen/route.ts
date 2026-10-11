
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
    const customer = requireRole(
      await getCurrentUser(),
      ["CUSTOMER"]
    );

    const { id } = await params;

    // Reopen only a conversation created by this customer
    // that is currently RESOLVED.
    const result = await prisma.conversation.updateMany({
      where: {
        id,
        createdById: customer.id,
        status: "RESOLVED",
      },
      data: {
        status: "OPEN",
        assignedToId: null,
        resolvedAt: null,
      },
    });

    if (result.count === 0) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id,
          createdById: customer.id,
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

      return NextResponse.json(
        {
          error:
            "Only resolved conversations can be reopened",
        },
        { status: 409 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
        resolvedAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Conversation reopened successfully",
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
        { error: "Only customers can reopen conversations" },
        { status: 403 }
      );
    }

    console.error("Reopen conversation failed:", error);

    return NextResponse.json(
      { error: "Unable to reopen conversation" },
      { status: 500 }
    );
  }
}
