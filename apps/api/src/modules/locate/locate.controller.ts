import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiKeyScope,
  LOCATE_MAX_PRODUCTS,
  locateNextQuerySchema,
  locateRequestSchema,
  type LocateAccepted,
  type LocateEvent,
  type LocateNextQuery,
  type LocateRequest,
} from '@ims/shared';
import { AuthenticatedThrottle } from '../../common/throttling';
import { zodPipe } from '../../common/zod-validation.pipe';
import { ApiKeyScopes, CurrentApiKey } from '../api-keys/api-key.decorators';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/request-user';
import { LocateFeed } from './locate-feed';
import { LocateService } from './locate.service';

/**
 * Drawer lights (Phase 13). Any signed-in user may report a search — the web app and the lab
 * panel both do — so there is no `@Roles`. A key needs `locate:write` to report and `locate:read`
 * to wait for events.
 *
 * Every answer here is drawers, cells and a colour (K2): no product, no person.
 */
@AuthenticatedThrottle
@Controller('locate')
export class LocateController {
  constructor(
    private readonly locate: LocateService,
    private readonly feed: LocateFeed,
  ) {}

  /*
   * No Idempotency-Key, unlike the stock writes: nothing is stored, and a repeated locate is
   * meant to light the drawers again.
   */
  @ApiKeyScopes({
    summary: `Light the cabinet drawers that hold these products: green where some are available, red where they live but none is available. Up to ${LOCATE_MAX_PRODUCTS} product ids. Answers 202 with the event number, or a null one when none of the products is on a shelf. Limited per key.`,
    scopes: [ApiKeyScope.LOCATE_WRITE],
    body: locateRequestSchema,
  })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async report(
    @Body(zodPipe(locateRequestSchema)) body: LocateRequest,
    @CurrentUser() actor: RequestUser,
    @CurrentApiKey() apiKey: { id: string } | null,
  ): Promise<LocateAccepted> {
    // Per key, or per signed-in user. A key is its own caller even when it shares a service
    // account, and the service stays unaware of keys (api-key.policies.ts).
    const caller = apiKey === null ? `user:${actor.id}` : `apikey:${apiKey.id}`;
    return this.locate.locate(body.productIds, caller);
  }

  @ApiKeyScopes({
    summary:
      'Wait for the next drawer-light event after `after` (the last seq you acted on; omit it on start-up). Answers at once if one is waiting, otherwise holds the request up to `wait` seconds (capped at the server maximum, which is also the default) and answers 204 if nothing happened. Never returns an expired event.',
    scopes: [ApiKeyScope.LOCATE_READ],
    query: locateNextQuerySchema,
  })
  @Get('next')
  async next(
    @Query(zodPipe(locateNextQuerySchema)) query: LocateNextQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LocateEvent | undefined> {
    // A light that drops its connection must not keep a waiting slot for the rest of the wait —
    // including one that dropped while the guards were still running, before this listener.
    const gone = new AbortController();
    response.on('close', () => gone.abort());
    if (response.socket?.destroyed ?? true) gone.abort();
    const event = await this.feed.next(query.after, query.wait, gone.signal);
    if (event === null) response.status(HttpStatus.NO_CONTENT);
    return event ?? undefined;
  }

  @ApiKeyScopes({
    summary:
      'The most recent drawer-light event, for checking a setup. Answers 204 when there is none, or it has expired.',
    scopes: [ApiKeyScope.LOCATE_READ],
  })
  @Get('latest')
  latest(@Res({ passthrough: true }) response: Response): LocateEvent | undefined {
    const event = this.feed.latest();
    if (event === null) response.status(HttpStatus.NO_CONTENT);
    return event ?? undefined;
  }
}
