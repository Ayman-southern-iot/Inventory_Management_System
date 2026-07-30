import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Phase 05 task 5.1 — uploaded files (signatures, invoices).
 *
 * The bytes themselves are never exposed by path. Everything here is metadata plus an id; a
 * caller who wants the content asks for a short-lived signed URL, the same way BOM PDFs work.
 */

export const STORED_FILE_KINDS = ['SIGNATURE', 'INVOICE'] as const;
export type StoredFileKind = (typeof STORED_FILE_KINDS)[number];
export const storedFileKindSchema = z.enum(
  STORED_FILE_KINDS as readonly [StoredFileKind, ...StoredFileKind[]],
);

/**
 * What each kind is allowed to be, enforced on the server by **magic bytes** rather than by the
 * `Content-Type` header — the caller controls the header, but not the first four bytes of the
 * body. Listed here too so the file picker can filter and the copy can say what is accepted.
 */
export const ACCEPTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
] as const;

export const storedFileSchema = z.object({
  id: uuidSchema,
  kind: storedFileKindSchema,
  /** What the uploader called it. Display only — it is never part of a path. */
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type StoredFile = z.infer<typeof storedFileSchema>;

/** A short-lived signed URL for one file, mirroring the BOM PDF download contract. */
export const fileDownloadUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type FileDownloadUrl = z.infer<typeof fileDownloadUrlSchema>;
