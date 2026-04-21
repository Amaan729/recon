import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";

  const contacts = await prisma.contact.findMany({
    where: {
      userId: session.user.id,
      ...(q
        ? {
            OR: [
              { email: { contains: q } },
              { name: { contains: q } },
              { company: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json(contacts);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await prisma.contact.delete({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
