import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { ProductDetail } from '@ims/shared';

/**
 * The loan list: the one structure a key-reachable route can answer with that names people (each
 * borrower and project). Typed against the contract, so renaming the field breaks the build here
 * instead of quietly re-opening the leak.
 */
const LOAN_LIST_FIELD: keyof ProductDetail = 'activeBorrows';

/**
 * K2 (Ayman, confirmed 2026-10-01): no person's name reaches an API key, on any route, response
 * bodies included. This is the one place that enforces it on what goes out (Arif, 2026-10-01: one
 * place for every key-authenticated request, not a helper each handler has to remember — the
 * per-route fix of 2026-09-29 covered the `GET` alone, and `PATCH /products/:id` kept leaking).
 *
 * For a request a key authenticated, every loan list anywhere in the answer is returned empty; how
 * much is out still shows in the placements' reserved and available figures. A person's request
 * passes through untouched. Registered globally in `AppModule`, so a route added later is covered
 * without anyone remembering it; `api-key-no-person-data.int-spec.ts` walks the key route registry
 * and fails if any answer carries a person.
 */
@Injectable()
export class KeyResponseRedactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    // Set only by `JwtAuthGuard.attachApiKey`, i.e. only when a key authenticated this request.
    const { apiKey } = context.switchToHttp().getRequest<{ apiKey?: unknown }>();
    if (!apiKey) return next.handle();
    return next.handle().pipe(map(withoutLoans));
  }
}

/**
 * Plain objects and arrays are walked; anything else — a stream, a buffer, a file, a `Date` —
 * passes through as it is, because it is not response JSON this could rewrite safely.
 */
function withoutLoans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLoans);
  if (value === null || typeof value !== 'object') return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(
    Object.entries(value).map(([field, inner]) => [
      field,
      field === LOAN_LIST_FIELD && Array.isArray(inner) ? [] : withoutLoans(inner),
    ]),
  );
}
