
import { NextResponse } from "next/server";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireAuth } from "@/lib/auth/authorization";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const user = requireAuth(await getCurrentUser());
    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        ...(user.role === "CUSTOMER"
          ? { createdById: user.id }
          : { assignedToId: user.id }),
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          select: {
            id: true,
            content: true,
            messageType: true,
            senderId: true,
            isEdited: true,
            createdAt: true,
            updatedAt: true,
            attachments: {
              select: {
                id: true,
                url: true,
                fileName: true,
                fileType: true,
                fileSize: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ conversation }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    console.error("Get conversation failed:", error);

    return NextResponse.json(
      { error: "Unable to fetch conversation" },
      { status: 500 }
    );
  }
}
