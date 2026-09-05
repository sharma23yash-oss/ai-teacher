import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { UploadResponseBody } from "@/lib/types";
import { detectKind, extractDocument } from "@/lib/rag/extract";
import { indexDocument } from "@/lib/rag/store";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

const UNSUPPORTED_MESSAGE =
  "Supported formats are PDF, Word (.docx), PowerPoint (.pptx), and plain text (.txt, .md). " +
  "Legacy .doc and .ppt files need to be saved as .docx or .pptx first.";

function fail(error: string, status: number) {
  return NextResponse.json<UploadResponseBody>({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("That upload wasn't readable as a file.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail("No file was uploaded.", 400);
  }
  if (file.size === 0) {
    return fail("That file is empty.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail("File is too large (max 20MB).", 413);
  }

  const kind = detectKind(file.name, file.type || "");
  if (!kind) {
    return fail(UNSUPPORTED_MESSAGE, 415);
  }

  let extracted;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    extracted = await extractDocument(buffer, kind);
  } catch (error) {
    console.error("/api/upload extraction failed:", error);
    return fail(
      error instanceof Error && error.message
        ? `Couldn't read that file: ${error.message}`
        : "Couldn't read that file. Is it a valid document?",
      422,
    );
  }

  if (!extracted.text.trim()) {
    return fail(
      kind === "pdf"
        ? "That PDF has no extractable text — it's probably a scan. Try a text-based PDF."
        : "That file had no readable text in it.",
      422,
    );
  }

  // Indexing is the step that can call out to the embedding API. It is
  // written not to throw (it falls back to lexical indexing), but a failure
  // here must still leave the student with a usable upload rather than an
  // error — the first turn is grounded in the extracted text either way.
  try {
    const docId = randomUUID();
    const indexed = await indexDocument(docId, file.name, extracted.blocks);

    return NextResponse.json<UploadResponseBody>({
      ok: true,
      fileName: file.name,
      text: extracted.text,
      knowledgeBase: {
        docId,
        fileName: file.name,
        charCount: indexed.charCount,
        chunkCount: indexed.chunks.length,
        retrieval: indexed.retrieval,
      },
    });
  } catch (error) {
    console.error("/api/upload indexing failed:", error);
    return fail("Read the file, but couldn't index it for retrieval. Please try again.", 500);
  }
}
