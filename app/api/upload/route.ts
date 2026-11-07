import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { UploadResponseBody } from "@/lib/types";
import { detectKind, extractDocument, sniffKind } from "@/lib/rag/extract";
import { indexDocument } from "@/lib/rag/store";
import { uploadFileNameSchema } from "@/lib/schemas";

export const runtime = "nodejs";

// 4.5MB — generous for text-based notes/slides, small enough that a
// single upload can't be used to run up storage/CPU or embedding-API cost.
const MAX_FILE_BYTES = 4.5 * 1024 * 1024;

const UNSUPPORTED_MESSAGE =
  "Supported formats are PDF, Word (.docx), PowerPoint (.pptx), and plain text (.txt, .md). " +
  "Legacy .doc and .ppt files need to be saved as .docx or .pptx first.";

// Never shown unless something truly unanticipated happens (a browser quirk,
// a library throwing a shape we didn't expect) — every expected failure path
// below returns its own specific, actionable fail() message instead.
const UNEXPECTED_FAILURE_MESSAGE =
  "Something went wrong reading that file. Please try again, or try a different file.";

function fail(error: string, status: number) {
  return NextResponse.json<UploadResponseBody>({ ok: false, error }, { status });
}

async function handleUpload(request: Request): Promise<Response> {
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
    return fail("File is too large (max 4.5MB).", 413);
  }

  const fileName = uploadFileNameSchema.safeParse(file.name);
  if (!fileName.success) {
    return fail("That file name isn't valid.", 400);
  }

  const kind = detectKind(fileName.data, file.type || "");
  if (!kind) {
    return fail(UNSUPPORTED_MESSAGE, 415);
  }

  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    console.error("/api/upload: couldn't read the uploaded file's bytes:", error);
    return fail("Couldn't read that file's contents. Please try again.", 400);
  }

  // The name and browser-supplied MIME type that detectKind() just used are
  // both entirely client-controlled — a renamed or mislabeled file sails
  // through them. This checks the bytes actually delivered against the type
  // we're about to trust, independent of what the upload claimed to be.
  if (!sniffKind(buffer, kind)) {
    return fail(
      "That file's contents don't match its type — it may be renamed or corrupted.",
      415,
    );
  }

  let extracted;
  try {
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
    const indexed = await indexDocument(docId, fileName.data, extracted.blocks, extracted.pageUnit);

    return NextResponse.json<UploadResponseBody>({
      ok: true,
      fileName: fileName.data,
      text: extracted.text,
      knowledgeBase: {
        docId,
        fileName: fileName.data,
        charCount: indexed.charCount,
        chunkCount: indexed.chunks.length,
        retrieval: indexed.retrieval,
        pageUnit: indexed.pageUnit,
        outline: indexed.outline,
      },
    });
  } catch (error) {
    console.error("/api/upload indexing failed:", error);
    return fail("Read the file, but couldn't index it for retrieval. Please try again.", 500);
  }
}

// A single outer boundary around the whole route: whatever goes wrong above —
// including anything not already caught by a more specific try/catch — this
// guarantees the client only ever receives a clean, valid JSON
// { ok: false, error } body with a message a student can act on. Without it,
// an unanticipated exception could otherwise escape as an unhandled server
// error (a non-JSON response), which would then surface client-side as a
// confusing, unrelated parse failure instead of a clear upload error.
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleUpload(request);
  } catch (error) {
    console.error("/api/upload: unexpected failure:", error);
    return fail(UNEXPECTED_FAILURE_MESSAGE, 500);
  }
}
