import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail, getGmailProfile } from "@/lib/gmail";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const body = await req.json() as {
    to: string;
    name?: string;
    company?: string;
    subject: string;
    body: string;
    resumeId?: string;
    followUpMode?: string;  // auto | manual | none
    followUpDays?: number;
  };

  // Capture sender IP for self-open detection
  const forwarded = req.headers.get("x-forwarded-for");
  const senderIp = forwarded?.split(",")[0].trim() ?? "unknown";

  // Upsert contact
  const contact = await prisma.contact.upsert({
    where: { userId_email: { userId, email: body.to } },
    create: { userId, email: body.to, name: body.name, company: body.company },
    update: { name: body.name ?? undefined, company: body.company ?? undefined },
  });

  // Create email record
  const emailRecord = await prisma.email.create({
    data: {
      userId,
      contactId: contact.id,
      toEmail: body.to.toLowerCase().trim(),
      subject: body.subject,
      body: body.body,
      status: "pending",
      senderIp,
      resumeId: body.resumeId ?? null,
      followUpMode: body.followUpMode ?? "none",
      followUpDays: body.followUpDays ?? null,
    },
  });

  try {
    const profile = await getGmailProfile(userId);
    const fromEmail = profile.emailAddress!;
    const fromName = session.user.name ?? fromEmail;

    const { gmailId } = await sendEmail({
      userId,
      from: `${fromName} <${fromEmail}>`,
      to: body.to,
      subject: body.subject,
      body: body.body,
      trackingId: emailRecord.trackingId,
      resumeId: body.resumeId,
      resumeEmailId: emailRecord.id,
    });

    await prisma.email.update({
      where: { id: emailRecord.id },
      data: { gmailId, status: "sent", sentAt: new Date() },
    });

    return NextResponse.json({ ok: true, emailId: emailRecord.id, trackingId: emailRecord.trackingId });
  } catch (err) {
    await prisma.email.update({
      where: { id: emailRecord.id },
      data: { status: "failed" },
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
