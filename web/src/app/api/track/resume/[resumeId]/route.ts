import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOpenMeta } from "@/lib/tracking";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> }
) {
  const { resumeId } = await params;
  const emailId = req.nextUrl.searchParams.get("e") ?? undefined;

  const resume = await prisma.resume.findUnique({
    where: { id: resumeId },
    select: { id: true, filename: true, userId: true },
  });

  if (!resume) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get sender IP for self-open detection
  let senderIp: string | null = null;
  if (emailId) {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: { senderIp: true },
    });
    senderIp = email?.senderIp ?? null;
  }

  // Log resume open (non-blocking)
  (async () => {
    try {
      const meta = await getOpenMeta(req, senderIp);
      if (meta.browser === "Gmail Prefetch") return;

      await prisma.resumeOpen.create({
        data: {
          resumeId: resume.id,
          emailId: emailId ?? null,
          ip: meta.ip,
          city: meta.city,
          country: meta.country,
          device: meta.device,
          isSelf: meta.isSelf,
        },
      });
    } catch {
      // non-critical
    }
  })();

  // Redirect to the actual PDF
  const pdfUrl = `${process.env.NEXT_PUBLIC_APP_URL}/uploads/resumes/${resume.userId}/${resume.filename}`;
  return NextResponse.redirect(pdfUrl);
}
