
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json({ user }, { status: 200 });
  } catch (error) {
    console.error("Get current user failed:", error);

    return NextResponse.json(
      { error: "Unable to fetch current user" },
      { status: 500 }
    );
  }
}
