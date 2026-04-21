import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/extension/sent-ids?key=<extensionKey>
// Returns all trackingIds + sentAt timestamps for this user's sent emails
// (last 30 days). The Chrome extension calls this on startup to seed its
// local sentEmails map, so it can detect self-opens for dashboard-sent
// emails too — not just Gmail-extension-sent ones.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { extensionKey: key } });
  if (!user) return NextResponse.json({ error: "Invalid key" }, { status: 401 });

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const emails = await prisma.email.findMany({
    where: { userId: user.id, status: "sent", sentAt: { gte: cutoff } },
    select: { trackingId: true, sentAt: true },
  });

  // Return as {trackingId: sentAtMs} map — same shape as sentEmails in content.js
  const ids: Record<string, number> = {};
  for (const e of emails) {
    ids[e.trackingId] = e.sentAt ? e.sentAt.getTime() : Date.now();
  }

  return NextResponse.json({ ids });
}
