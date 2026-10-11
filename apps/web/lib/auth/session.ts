
import { prisma } from "@repo/db/clients";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";



const SESSION_COOKIE_NAME="customer_care_session";
const SESSION_DURATION_MS=7*24*60*60*1000;

function hashToken(token:string){
    return createHash("sha256").update(token).digest("hex")
}

export async function createSession(userId:string){
    const token=randomBytes(32).toString("hex");

    const expiresAt=new Date(Date.now()+SESSION_DURATION_MS);

    await prisma.session.create({
        data:{
            userId,
            token:hashToken(token),
            expiresAt
        },
    });

    const cookieStore=await cookies();

    cookieStore.set(SESSION_COOKIE_NAME,token,{
        httpOnly:true,
        secure:process.env.NODE_ENV==="production",
        sameSite:"lax",
        path:"/",
        expires:expiresAt,
    });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: {
        token: hashToken(token),
      },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: {
      token: hashToken(token),
    },
    include: {
      user: true,
    },
  });

  if (!session || session.expiresAt <= new Date()) {
    await deleteSession();
    return null;
  }

  if (!session.user.isActive) {
    await deleteSession();
    return null;
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    expiresAt: session.expiresAt,
  };
}