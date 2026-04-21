import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail, getGmailProfile } from "@/lib/gmail";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;
  const { subject, body } = await req.json() as { subject: string; body: string };

  const original = await prisma.email.findUnique({
    where: { id, userId },
    include: { contact: true },
  });
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!original.contact) return NextResponse.json({ error: "Email has no recipient" }, { status: 400 });
  if (original.followUpSent) return NextResponse.json({ error: "Follow-up already sent" }, { status: 400 });

  const forwarded = req.headers.get("x-forwarded-for");
  const senderIp = forwarded?.split(",")[0].trim() ?? "unknown";

  const followUpRecord = await prisma.email.create({
    data: {
      userId,
      contactId: original.contactId,
      subject,
      body,
      status: "pending",
      senderIp,
      isFollowUp: true,
      parentEmailId: original.id,
      followUpMode: "none",
    },
  });

  try {
    const profile = await getGmailProfile(userId);
    const fromEmail = profile.emailAddress!;
    const fromName = session.user.name ?? fromEmail;

    const { gmailId } = await sendEmail({
      userId,
      from: `${fromName} <${fromEmail}>`,
      to: original.contact!.email,
      subject,
      body,
      trackingId: followUpRecord.trackingId,
    });

    await prisma.email.update({
      where: { id: followUpRecord.id },
      data: { gmailId, status: "sent", sentAt: new Date() },
    });

    await prisma.email.update({
      where: { id: original.id },
      data: { followUpSent: true, followUpSentAt: new Date() },
    });

    return NextResponse.json({ ok: true, emailId: followUpRecord.id });
  } catch (err) {
    await prisma.email.update({ where: { id: followUpRecord.id }, data: { status: "failed" } });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
