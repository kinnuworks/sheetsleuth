import { XlsxReadError } from './errors.js';

/** Resource limits applied before any ZIP entry is decompressed. */
export const XLSX_LIMITS = {
  maxEntries: 10_000,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200,
} as const;

/** Metadata needed to enforce XLSX ZIP limits without inflating the archive. */
export interface ZipEntryInfo {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionRatio: number;
}

export interface ZipSafetySuccess {
  readonly ok: true;
  readonly entries: readonly ZipEntryInfo[];
}

export interface ZipSafetyFailure {
  readonly ok: false;
  readonly error: XlsxReadError;
}

export type ZipSafetyResult = ZipSafetySuccess | ZipSafetyFailure;

const textDecoder = new TextDecoder();

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8);

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)) >>>
  0;

const hasBytes = (bytes: Uint8Array, offset: number, length: number): boolean =>
  offset >= 0 && length >= 0 && offset <= bytes.length - length;

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(bytes, offset) === 0x0605_4b50) {
      return offset;
    }
  }
  return -1;
};

const failure = (code: ConstructorParameters<typeof XlsxReadError>[0], message: string) => ({
  ok: false as const,
  error: new XlsxReadError(code, message),
});

/**
 * Checks the ZIP central directory before decompression.
 *
 * This protects callers from entry-count, expansion, and compression-ratio bombs.
 */
export const checkZipSafety = (input: Uint8Array): ZipSafetyResult => {
  if (!(input instanceof Uint8Array)) {
    return failure('invalid-input', 'XLSX input must be a Uint8Array.');
  }

  const endOffset = findEndOfCentralDirectory(input);
  if (endOffset < 0 || !hasBytes(input, endOffset, 22)) {
    return failure('invalid-zip', 'The XLSX file has no valid ZIP directory.');
  }

  const diskNumber = readUint16(input, endOffset + 4);
  const centralDirectoryDisk = readUint16(input, endOffset + 6);
  const entriesOnDisk = readUint16(input, endOffset + 8);
  const totalEntries = readUint16(input, endOffset + 10);
  const centralDirectorySize = readUint32(input, endOffset + 12);
  const centralDirectoryOffset = readUint32(input, endOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    return failure('unsupported-zip', 'Multi-disk ZIP archives are not supported.');
  }

  if (totalEntries > XLSX_LIMITS.maxEntries) {
    return failure(
      'zip-entry-limit',
      `The XLSX file contains ${totalEntries.toLocaleString()} ZIP entries; the limit is ${XLSX_LIMITS.maxEntries.toLocaleString()}.`,
    );
  }

  if (!hasBytes(input, centralDirectoryOffset, centralDirectorySize)) {
    return failure('invalid-zip', 'The XLSX central directory is truncated.');
  }

  const entries: ZipEntryInfo[] = [];
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (!hasBytes(input, offset, 46) || readUint32(input, offset) !== 0x0201_4b50) {
      return failure('invalid-zip', 'The XLSX central directory contains an invalid entry.');
    }

    const compressedSize = readUint32(input, offset + 20);
    const uncompressedSize = readUint32(input, offset + 24);
    const nameLength = readUint16(input, offset + 28);
    const extraLength = readUint16(input, offset + 30);
    const commentLength = readUint16(input, offset + 32);
    const entryLength = 46 + nameLength + extraLength + commentLength;

    if (!hasBytes(input, offset, entryLength)) {
      return failure('invalid-zip', 'The XLSX central directory entry is truncated.');
    }

    if (compressedSize === 0xffff_ffff || uncompressedSize === 0xffff_ffff) {
      return failure('unsupported-zip', 'ZIP64 XLSX entries are not supported.');
    }

    const name = textDecoder.decode(input.subarray(offset + 46, offset + 46 + nameLength));
    const compressionRatio =
      compressedSize === 0
        ? uncompressedSize === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : uncompressedSize / compressedSize;

    if (compressionRatio > XLSX_LIMITS.maxCompressionRatio) {
      return failure(
        'compression-ratio-limit',
        `The ZIP entry ${name || '<unnamed>'} has a compression ratio above ${XLSX_LIMITS.maxCompressionRatio}:1.`,
      );
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > XLSX_LIMITS.maxUncompressedBytes) {
      return failure(
        'uncompressed-size-limit',
        `The XLSX file expands beyond the ${XLSX_LIMITS.maxUncompressedBytes.toLocaleString()} byte limit.`,
      );
    }

    entries.push({ name, compressedSize, uncompressedSize, compressionRatio });
    offset += entryLength;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    return failure('invalid-zip', 'The XLSX central directory size does not match its entries.');
  }

  return { ok: true, entries };
};
