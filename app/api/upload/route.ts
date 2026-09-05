import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import type { UploadResponseBody } from "@/lib/types";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const TEXT_EXTENSIONS = [".txt", ".md"];

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json<UploadResponseBody>(
      { ok: false, error: "No file was uploaded." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json<UploadResponseBody>(
      { ok: false, error: "File is too large (max 20MB)." },
      { status: 413 },
    );
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isText =
    file.type.startsWith("text/") ||
    TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

  if (!isPdf && !isText) {
    return NextResponse.json<UploadResponseBody>(
      { ok: false, error: "Only PDF and plain text (.txt, .md) files are supported." },
      { status: 415 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    if (isPdf) {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return NextResponse.json<UploadResponseBody>({
          ok: true,
          fileName: file.name,
          text: result.text,
        });
      } finally {
        await parser.destroy();
      }
    }

    const text = buffer.toString("utf-8");
    return NextResponse.json<UploadResponseBody>({
      ok: true,
      fileName: file.name,
      text,
    });
  } catch (error) {
    console.error("Unexpected /api/upload error:", error);
    return NextResponse.json<UploadResponseBody>(
      { ok: false, error: "Failed to read that file. Is it a valid PDF or text file?" },
      { status: 422 },
    );
  }
}
