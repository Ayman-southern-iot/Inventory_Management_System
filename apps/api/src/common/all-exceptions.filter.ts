import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode, type ApiErrorBody } from '@ims/shared';
import { DomainError, RateLimitedError } from './errors';

/**
 * The single place an error becomes an HTTP response. Every response is `{ code, message }`,
 * and an unexpected error becomes a generic INTERNAL — a user-facing message never leaks SQL,
 * a stack trace, or an internal id (rules/00-engineering-standards.md).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body, retryAfterSeconds } = this.toResponse(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${body.code}`);
    }

    if (retryAfterSeconds !== undefined && !response.headersSent) {
      // RFC 7231 §7.1.3 — Retry-After is integer seconds (or HTTP-date). We always use seconds
      // so clients and intermediaries don't need a clock to interpret it. Setting it only when
      // we have a finite value avoids a `Retry-After: NaN` on malformed upstream errors.
      response.setHeader('Retry-After', String(Math.ceil(retryAfterSeconds)));
    }

    response.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
  ): { status: number; body: ApiErrorBody; retryAfterSeconds?: number } {
    if (exception instanceof DomainError) {
      const payload = exception.getResponse() as ApiErrorBody;
      const body: ApiErrorBody = {
        code: payload.code,
        message: payload.message,
        ...(payload.details === undefined ? {} : { details: payload.details }),
      };
      const retryAfterSeconds =
        exception instanceof RateLimitedError
          ? this.retryAfterFromDetails(payload.details)
          : undefined;
      return { status: exception.getStatus(), body, retryAfterSeconds };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // The Nest throttler throws `ThrottlerException` (a plain HttpException, status=429) and
      // already writes its own `Retry-After-{name}` headers in `ThrottlerGuard.handleRequest`
      // before throwing. We do NOT add a generic `Retry-After` here — doing so would duplicate
      // the header and overwrite a more specific value with a less specific one. Clients reading
      // the throttler's per-tier header continue to work; clients needing a single name can
      // inspect either.
      return {
        status,
        body: { code: this.codeForStatus(status), message: exception.message },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ErrorCode.INTERNAL, message: 'Something went wrong' },
    };
  }

  /**
   * Reads the `retryAfterSeconds` out of a `RateLimitedError.details`, defensively. A
   * future-shaped payload (number, object, or any structurally wrong value) must NEVER become
   * a `Retry-After: NaN` header — the absence of a header is a better signal than a wrong one.
   */
  private retryAfterFromDetails(details: unknown): number | undefined {
    if (!details || typeof details !== 'object') return undefined;
    const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      // Multer rejects an oversized upload before the handler runs, and Nest surfaces that as a
      // 413. Falling through to INTERNAL would tell the user the server broke.
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      default:
        return ErrorCode.INTERNAL;
    }
  }
}
