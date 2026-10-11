
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireAuth } from "@/lib/auth/authorization";

export const runtime = "nodejs";

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  { params }: RouteContext
) {
  try {
    // 1. Authenticate the user
    const user = requireAuth(await getCurrentUser());
    const { id: conversationId } = await params;

    // 2. Validate the request body
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const result = sendMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid message content",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // 3. Check conversation access
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ...(user.role === "CUSTOMER"
          ? { createdById: user.id }
          : { assignedToId: user.id }),
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

    // 4. Prevent messages in closed or resolved conversations
    if (
      conversation.status === "CLOSED" ||
      conversation.status === "RESOLVED"
    ) {
      return NextResponse.json(
        { error: "This conversation is no longer accepting messages" },
        { status: 409 }
      );
    }

    // 5. Save the message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        content: result.data.content,
        messageType: "TEXT",
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        messageType: true,
        isEdited: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Message sent successfully",
        data: message,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    console.error("Send message failed:", error);

    return NextResponse.json(
      { error: "Unable to send message" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  try {
    const user = requireAuth(await getCurrentUser());
    const { id: conversationId } = await params;

    // Check that the user can access this conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ...(user.role === "CUSTOMER"
          ? { createdById: user.id }
          : { assignedToId: user.id }),
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Read pagination parameters
    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get("limit") ?? "50");
    const before = searchParams.get("before");

    if (
      !Number.isInteger(limitParam) ||
      limitParam < 1 ||
      limitParam > 100
    ) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 100" },
        { status: 400 }
      );
    }

    if (before && Number.isNaN(Date.parse(before))) {
      return NextResponse.json(
        { error: "before must be a valid timestamp" },
        { status: 400 }
      );
    }

    // Fetch newest messages first, with one extra to detect more pages
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        ...(before
          ? { createdAt: { lt: new Date(before) } }
          : {}),
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limitParam + 1,
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        messageType: true,
        isEdited: true,
        createdAt: true,
        updatedAt: true,
        attachments: {
          select: {
            id: true,
            url: true,
            fileName: true,
            fileType: true,
          },
        },
      },
    });

    const hasMore = messages.length > limitParam;
    const page = messages.slice(0, limitParam);
    const nextBefore = hasMore
      ? page[page.length - 1].createdAt.toISOString()
      : null;

    // Return messages oldest-first for display in the chat
    page.reverse();

    return NextResponse.json({
      messages: page,
      pagination: {
        limit: limitParam,
        hasMore,
        nextBefore,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    console.error("Fetch message history failed:", error);

    return NextResponse.json(
      { error: "Unable to fetch message history" },
      { status: 500 }
    );
  }
}
