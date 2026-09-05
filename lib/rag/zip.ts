import "server-only";

/**
 * A minimal ZIP reader, because .docx and .pptx are both just ZIP archives of
 * XML and the alternative was pulling a parser dependency into the tree for
 * two file types.
 *
 * Only what those two formats actually use is implemented: the end-of-central
 * -directory record, the central directory, and the two compression methods
 * Office writes (stored and raw deflate). Deflate is handled by the platform's
 * own DecompressionStream, so there is no bundled inflate implementation here
 * either.
 *
 * Everything is bounds-checked and every failure is a thrown Error with a
 * readable message — a corrupt upload has to surface as "we couldn't read
 * that file", never as a hang or a stack trace in the response.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_MIN_SIZE = 22;
/** ZIP comments are capped at 65535 bytes, so the EOCD is never deeper than this. */
const EOCD_MAX_SCAN = 65535 + EOCD_MIN_SIZE;

/** Refuse absurd archives rather than trying to inflate them. */
const MAX_ENTRIES = 5000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - EOCD_MAX_SCAN);
  for (let offset = view.byteLength - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("Not a ZIP archive (no end-of-central-directory record).");
}

/** Lists the archive's entries without inflating any of them. */
export function readZipDirectory(buffer: Uint8Array): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (entryCount > MAX_ENTRIES) {
    throw new Error("ZIP archive has too many entries to read safely.");
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  const decoder = new TextDecoder("utf-8");

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break;

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    if (nameStart + nameLength > view.byteLength) break;
    const name = decoder.decode(buffer.subarray(nameStart, nameStart + nameLength));

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This runtime has no DecompressionStream, so deflate entries can't be read.");
  }
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflated);
}

/** Inflates one entry and decodes it as UTF-8 text. */
export async function readZipEntryText(
  buffer: Uint8Array,
  entry: ZipEntry,
): Promise<string> {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`Entry "${entry.name}" is too large to read.`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const header = entry.localHeaderOffset;
  if (header + 30 > view.byteLength || view.getUint32(header, true) !== LOCAL_SIGNATURE) {
    throw new Error(`Entry "${entry.name}" has a corrupt local header.`);
  }

  // The local header repeats the name and extra fields with its own lengths,
  // which can differ from the central directory's — always trust these.
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const dataStart = header + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.byteLength) {
    throw new Error(`Entry "${entry.name}" runs past the end of the archive.`);
  }

  const raw = buffer.subarray(dataStart, dataEnd);
  const decoder = new TextDecoder("utf-8");

  if (entry.compressionMethod === 0) return decoder.decode(raw);
  if (entry.compressionMethod === 8) return decoder.decode(await inflateRaw(raw));

  throw new Error(
    `Entry "${entry.name}" uses an unsupported compression method (${entry.compressionMethod}).`,
  );
}
