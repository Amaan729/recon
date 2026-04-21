import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const emails = await prisma.email.findMany({
    where: { userId, status: "sent" },
    select: {
      id: true,
      trackingId: true,
      subject: true,
      toEmail: true,
      sentAt: true,
      openedAt: true,
      openCount: true,
      isFollowUp: true,
      followUpSent: true,
      followUpSentAt: true,
      contact: { select: { name: true, email: true, company: true } },
      resume: {
        select: {
          name: true,
          opens: {
            where: { isSelf: false },
            orderBy: { openedAt: "desc" },
            select: { id: true, openedAt: true },
          },
        },
      },
      opens: { orderBy: { openedAt: "desc" } },
    },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  return NextResponse.json(emails);
}
