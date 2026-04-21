import { google } from "googleapis";
import { prisma } from "./prisma";
import { readFile } from "fs/promises";
import path from "path";

async function getGmailClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account?.access_token) throw new Error("No Google account linked");

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token ?? undefined,
  });

  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : undefined,
        },
      });
    }
  });

  return google.gmail({ version: "v1", auth: oauth2 });
}

export async function getGmailProfile(userId: string) {
  const gmail = await getGmailClient(userId);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data;
}

function buildMultipartRaw(params: {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  attachmentPath?: string;
  attachmentName?: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
  ];

  if (params.attachmentPath) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"', "");
    lines.push(params.htmlBody, "");
    lines.push(`--${boundary}`);
    lines.push(
      `Content-Type: application/pdf; name="${params.attachmentName ?? "resume.pdf"}"`,
      `Content-Disposition: attachment; filename="${params.attachmentName ?? "resume.pdf"}"`,
      "Content-Transfer-Encoding: base64",
      ""
    );
    // Attachment bytes added after encoding
  } else {
    lines.push('Content-Type: text/html; charset="UTF-8"', "");
    lines.push(params.htmlBody);
  }

  return lines.join("\n");
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail({
  userId,
  from,
  to,
  subject,
  body,
  trackingId,
  resumeId,
  resumeEmailId,
}: {
  userId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  trackingId: string;
  resumeId?: string | null;
  resumeEmailId?: string;
}) {
  const gmail = await getGmailClient(userId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  // Build HTML from plain text body
  const htmlBody =
    body
      .split("\n")
      .map((line) => `<p style="margin:0 0 12px">${line || "&nbsp;"}</p>`)
      .join("") +
    (resumeId
      ? `<p style="margin:16px 0"><a href="${appUrl}/api/track/resume/${resumeId}?e=${resumeEmailId}" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View Resume →</a></p>`
      : "") +
    `<img src="${appUrl}/api/track/${trackingId}/pixel.gif" width="1" height="1" style="display:none" alt="" />`;

  let raw: string;

  if (resumeId) {
    // Attach the actual PDF
    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (resume) {
      const filePath = path.join(
        process.cwd(),
        "public",
        "uploads",
        "resumes",
        userId,
        resume.filename
      );
      try {
        const pdfBytes = await readFile(filePath);
        const boundary = `boundary_${Date.now()}`;
        const header = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "",
          htmlBody,
          "",
          `--${boundary}`,
          `Content-Type: application/pdf; name="${resume.filename}"`,
          `Content-Disposition: attachment; filename="${resume.name}.pdf"`,
          "Content-Transfer-Encoding: base64",
          "",
          pdfBytes.toString("base64"),
          "",
          `--${boundary}--`,
        ].join("\n");

        raw = Buffer.from(header)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      } catch {
        // File read failed, send without attachment
        const fallback = buildMultipartRaw({ from, to, subject, htmlBody });
        raw = toBase64Url(fallback);
      }
    } else {
      const fallback = buildMultipartRaw({ from, to, subject, htmlBody });
      raw = toBase64Url(fallback);
    }
  } else {
    const msg = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      htmlBody,
    ].join("\n");
    raw = toBase64Url(msg);
  }

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { gmailId: response.data.id };
}
