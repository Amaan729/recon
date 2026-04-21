import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

// ── GET ──────────────────────────────────────────────────────────────────────
// Two modes:
//   1. Extension popup verification — sends x-extension-key header
//   2. Dashboard settings page — uses session cookie
export async function GET(req: NextRequest) {
  const headerKey = req.headers.get("x-extension-key");
  if (headerKey) {
    const user = await prisma.user.findUnique({ where: { extensionKey: headerKey } });
    if (!user) return NextResponse.json({ error: "Invalid key" }, { status: 401 });
    return NextResponse.json({ ok: true });
  }

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { extensionKey: true },
  });

  let key = user?.extensionKey;
  if (!key) {
    key = randomBytes(24).toString("hex");
    await prisma.user.update({ where: { id: session.user.id }, data: { extensionKey: key } });
  }

  return NextResponse.json({ key });
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Called when compose window opens (pre-registration).
// `to` and `subject` may be empty — they get filled in via PATCH on send.
export async function POST(req: NextRequest) {
  const { extensionKey, to, subject } = await req.json() as {
    extensionKey: string;
    to?: string;
    subject?: string;
  };

  const user = await prisma.user.findUnique({ where: { extensionKey } });
  if (!user) return NextResponse.json({ error: "Invalid key" }, { status: 401 });

  // Capture sender IP at compose time (best proxy for self-open detection)
  const forwarded = req.headers.get("x-forwarded-for");
  const senderIp = forwarded?.split(",")[0].trim() ?? "unknown";

  // Upsert contact only if we have an email address
  let contactId: string | undefined;
  if (to && to.includes("@")) {
    const contact = await prisma.contact.upsert({
      where: { userId_email: { userId: user.id, email: to } },
      create: { userId: user.id, email: to },
      update: {},
    });
    contactId = contact.id;
  }

  const emailRecord = await prisma.email.create({
    data: {
      userId: user.id,
      contactId,
      toEmail: to && to.includes("@") ? to.toLowerCase().trim() : undefined,
      subject: subject?.trim() || "(no subject)",
      body: "",
      status: "sent",
      sentAt: new Date(),
      senderIp,
      followUpMode: "none",
    },
  });

  // The pixel URL must use whatever the user configured as the dashboard URL
  // in the extension popup. If it's localhost:3001, it only works locally.
  // For real tracking, this must be a public URL (ngrok / Vercel).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  return NextResponse.json({
    trackingId: emailRecord.trackingId,
    pixelUrl: `${appUrl}/api/track/${emailRecord.trackingId}/pixel.gif`,
  });
}

// ── PATCH ────────────────────────────────────────────────────────────────────
// Called on send-click (fire-and-forget from the extension).
// Updates the pre-registered email record with the actual recipient + subject.
export async function PATCH(req: NextRequest) {
  const { extensionKey, trackingId, to, subject } = await req.json() as {
    extensionKey: string;
    trackingId: string;
    to?: string;
    subject?: string;
  };

  const user = await prisma.user.findUnique({ where: { extensionKey } });
  if (!user) return NextResponse.json({ error: "Invalid key" }, { status: 401 });

  const email = await prisma.email.findFirst({ where: { trackingId, userId: user.id } });
  if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Upsert real contact now that we have the actual recipient
  let contactId = email.contactId;
  if (to && to.includes("@")) {
    const contact = await prisma.contact.upsert({
      where: { userId_email: { userId: user.id, email: to } },
      create: { userId: user.id, email: to },
      update: {},
    });
    contactId = contact.id;
  }

  await prisma.email.update({
    where: { id: email.id },
    data: {
      contactId,
      toEmail: to && to.includes("@") ? to.toLowerCase().trim() : undefined,
      subject: subject?.trim() || email.subject,
    },
  });

  return NextResponse.json({ ok: true });
}
