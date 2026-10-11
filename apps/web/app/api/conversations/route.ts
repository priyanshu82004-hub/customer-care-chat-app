
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireAuth, requireRole } from "@/lib/auth/authorization";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const customer = requireRole(user, ["CUSTOMER"]);

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const result = createConversationSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid conversation details",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.create({
      data: {
        title: result.data.title,
        createdById: customer.id,
        status: "OPEN",
        members: {
          create: {
            userId: customer.id,
            role: "CUSTOMER",
          },
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Conversation created successfully",
        conversation,
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

    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Only customers can create conversations" },
        { status: 403 }
      );
    }

    console.error("Create conversation failed:", error);

    return NextResponse.json(
      { error: "Unable to create conversation" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    const authenticatedUser = requireAuth(user);

    const conversations = await prisma.conversation.findMany({
      where:
        authenticatedUser.role === "CUSTOMER"
          ? {
              createdById: authenticatedUser.id,
            }
          : {
              OR: [
                {
                  assignedToId: authenticatedUser.id,
                },
                {
                  assignedToId: null,
                  status: "OPEN",
                },
              ],
            },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        assignedToId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    return NextResponse.json(
      { conversations },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    console.error("List conversations failed:", error);

    return NextResponse.json(
      { error: "Unable to fetch conversations" },
      { status: 500 }
    );
  }
}
