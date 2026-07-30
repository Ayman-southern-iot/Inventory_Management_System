import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { DomainError } from '../../common/errors';

/**
 * The download endpoint reads a token, not a Bearer. The token must therefore:
 *
 *   1. say *which* BOM it is for, so a leaked URL cannot be replayed against
 *      any other BOM the attacker can guess the UUID of
 *   2. carry an expiry, so a leaked URL becomes useless
 *   3. be tamper-evident, so the expiry cannot be rewritten
 *
 * HMAC-SHA256 over `{ bomId, exp }` covers all three without the auth stack's
 * involvement. A separate signing secret (`PDF_SIGNING_SECRET`, validated at
 * boot to differ from `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`) keeps a leaked
 * download URL bounded: at worst the attacker pulls the bytes for a few
 * minutes, never impersonates a user.
 *
 * The wire format is `b64url(payload).b64url(hmac)` so it survives a URL without
 * encoding. The HMAC is computed over the *payload bytes* — not over the URL
 * — so the token is independent of where it ends up.
 */
export interface BomDownloadTokenPayload {
  /** The BOM the URL is bound to. The download endpoint compares against `:id`. */
  bomId: string;
  /** Seconds since epoch (UTC). Compared with `Math.floor(Date.now() / 1000)`. */
  exp: number;
}

export class PdfDownloadTokenInvalidError extends DomainError {
  /** Kept for the log line; deliberately not part of the response. */
  readonly reason: 'malformed' | 'expired' | 'mismatch';

  constructor(reason: 'malformed' | 'expired' | 'mismatch') {
    // The caller gets a stable code and nothing else. Passing `{ reason }` as `details` put it
    // straight into the response body (all-exceptions.filter.ts copies `details` through), so
    // the 403 distinguished "expired" from "mismatch" — i.e. it told an attacker their
    // signature verified and only the bomId was wrong, which is exactly the oracle the comment
    // said it was avoiding.
    super(
      ErrorCode.PDF_DOWNLOAD_TOKEN_INVALID,
      'The download link is invalid or has expired.',
      HttpStatus.FORBIDDEN,
    );
    this.reason = reason;
  }
}

@Injectable()
export class PdfSigningService {
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    this.key = Buffer.from(this.config.pdf.signedUrlKey, 'utf8');
  }

  /**
   * Sign a `{ bomId, exp }` payload. `ttlSeconds` comes from `AppConfig.pdf.signedUrlTtlSeconds`
   * so the controller never has to know about it.
   */
  sign(bomId: string): { token: string; expiresAt: Date; ttlSeconds: number } {
    const ttlSeconds = this.config.pdf.signedUrlTtlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload: BomDownloadTokenPayload = { bomId, exp };
    return {
      token: this.encode(payload),
      expiresAt: new Date(exp * 1000),
      ttlSeconds,
    };
  }

  /**
   * Verify a token. Throws `PdfDownloadTokenInvalidError` on any failure — the caller never
   * has to distinguish "expired" from "tampered", just refuse to serve.
   *
   * `expectedBomId` is passed in by the controller so a leaked token cannot be replayed
   * against a different BOM even by an attacker who knows both UUIDs.
   */
  verify(token: string, expectedBomId: string): BomDownloadTokenPayload {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) {
      throw new PdfDownloadTokenInvalidError('malformed');
    }
    const payloadB64 = token.slice(0, dot);
    const macB64 = token.slice(dot + 1);

    const payload = this.decode(payloadB64);
    const expectedMac = Buffer.from(this.computeMac(payloadB64), 'base64url');
    const providedMac = Buffer.from(macB64, 'base64url');
    // timingSafeEqual rejects length mismatches with an exception — handle both shapes.
    if (expectedMac.length !== providedMac.length || !timingSafeEqual(expectedMac, providedMac)) {
      throw new PdfDownloadTokenInvalidError('malformed');
    }

    if (payload.bomId !== expectedBomId) {
      throw new PdfDownloadTokenInvalidError('mismatch');
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new PdfDownloadTokenInvalidError('expired');
    }
    return payload;
  }

  private encode(payload: BomDownloadTokenPayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${payloadB64}.${this.computeMac(payloadB64)}`;
  }

  private decode(payloadB64: string): BomDownloadTokenPayload {
    let json: string;
    try {
      json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
      throw new PdfDownloadTokenInvalidError('malformed');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new PdfDownloadTokenInvalidError('malformed');
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as BomDownloadTokenPayload).bomId !== 'string' ||
      typeof (parsed as BomDownloadTokenPayload).exp !== 'number'
    ) {
      throw new PdfDownloadTokenInvalidError('malformed');
    }
    return parsed as BomDownloadTokenPayload;
  }

  private computeMac(payloadB64: string): string {
    return createHmac('sha256', this.key).update(payloadB64).digest('base64url');
  }
}