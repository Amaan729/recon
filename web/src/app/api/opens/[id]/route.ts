import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/opens/[id] — mark an open as "this was me" (isSelf = true)
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Make sure the open belongs to this user's email
  const open = await prisma.emailOpen.findUnique({
    where: { id },
    include: { email: { select: { userId: true, openCount: true, id: true } } },
  });

  if (!open) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (open.email.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (open.isSelf) return NextResponse.json({ ok: true }); // already marked

  // Mark as self-open and decrement email open count
  await prisma.emailOpen.update({ where: { id }, data: { isSelf: true } });

  if (open.email.openCount > 0) {
    await prisma.email.update({
      where: { id: open.email.id },
      data: { openCount: { decrement: 1 } },
    });
  }

  return NextResponse.json({ ok: true });
}
