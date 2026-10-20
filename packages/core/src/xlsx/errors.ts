/** Stable error categories returned by the XLSX reader. */
export type XlsxErrorCode =
  | 'invalid-input'
  | 'invalid-zip'
  | 'unsupported-zip'
  | 'zip-entry-limit'
  | 'uncompressed-size-limit'
  | 'compression-ratio-limit'
  | 'xml-doctype'
  | 'missing-part'
  | 'invalid-xml'
  | 'invalid-workbook';

/** A readable, typed failure produced while reading an XLSX file. */
export class XlsxReadError extends Error {
  readonly name = 'XlsxReadError';

  constructor(
    readonly code: XlsxErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}
