import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOpenMeta } from "@/lib/tracking";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  // ── Tracking logic runs BEFORE returning the response ─────────────────────
  // Critical on Vercel serverless: the runtime kills execution after the
  // response is sent, so fire-and-forget async IIFEs never complete.
  try {
    const email = await prisma.email.findUnique({
      where: { trackingId },
      select: { id: true, senderIp: true, openedAt: true },
    });

    if (email) {
      const meta = await getOpenMeta(req, email.senderIp ?? undefined);

      // NOTE: We no longer skip GoogleImageProxy.
      // Gmail routes ALL image loads (real opens + prefetch) through its proxy
      // with the "GoogleImageProxy" user-agent. Skipping it means we miss every
      // real open from Gmail users. Count them all — Gmail's proxy caches the
      // image so subsequent opens don't re-fire anyway.

      await prisma.emailOpen.create({
        data: {
          emailId: email.id,
          ip: meta.ip,
          city: meta.city,
          region: meta.region,
          country: meta.country,
          device: meta.device,
          os: meta.os,
          browser: meta.browser,
          isSelf: meta.isSelf,
        },
      });

      // Only increment the headline counter for non-self opens
      if (!meta.isSelf) {
        await prisma.email.update({
          where: { id: email.id },
          data: {
            openedAt: email.openedAt ?? new Date(),
            openCount: { increment: 1 },
          },
        });
      }
    }
  } catch {
    // Tracking failure is non-critical — still return the pixel
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}
