
import { NextResponse } from "next/server";
import { prisma } from "@repo/db/clients";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireRole } from "@/lib/auth/authorization";

export const runtime = "nodejs";

export async function GET() {
  try {
    requireRole(await getCurrentUser(), ["AGENT"]);

    const conversations = await prisma.conversation.findMany({
      where: {
        status: "OPEN",
        assignedToId: null,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
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

    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Only agents can view the queue" },
        { status: 403 }
      );
    }

    console.error("Fetch agent queue failed:", error);

    return NextResponse.json(
      { error: "Unable to fetch open conversations" },
      { status: 500 }
    );
  }
}
