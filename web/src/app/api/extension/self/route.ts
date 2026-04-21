import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/extension/self
// Called by the Chrome extension when it detects the user opened one of their
// own sent emails in Gmail. Marks the most recent non-self open for that email
// as isSelf=true and decrements openCount.
export async function PATCH(req: NextRequest) {
  const { extensionKey, trackingId } = await req.json() as {
    extensionKey: string;
    trackingId: string;
  };

  if (!extensionKey || !trackingId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify the extension key
  const user = await prisma.user.findUnique({ where: { extensionKey } });
  if (!user) return NextResponse.json({ error: "Invalid key" }, { status: 401 });

  // Find the email and verify ownership
  const email = await prisma.email.findFirst({
    where: { trackingId, userId: user.id },
    select: { id: true, openCount: true },
  });
  if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find the most recent non-self open for this email
  const open = await prisma.emailOpen.findFirst({
    where: { emailId: email.id, isSelf: false },
    orderBy: { openedAt: "desc" },
  });

  if (!open) return NextResponse.json({ ok: true, skipped: true });

  // Mark as self and decrement open count
  await prisma.emailOpen.update({ where: { id: open.id }, data: { isSelf: true } });

  if (email.openCount > 0) {
    await prisma.email.update({
      where: { id: email.id },
      data: { openCount: { decrement: 1 } },
    });
  }

  return NextResponse.json({ ok: true, markedId: open.id });
}
