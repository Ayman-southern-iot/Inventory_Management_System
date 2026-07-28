import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@ims/shared';
import { DomainError } from '../../common/errors';
import { Roles } from './auth.decorators';
import { RolesGuard } from './roles.guard';
import type { RequestUser } from './request-user';

/**
 * The metadata is attached by calling the real `@Roles()` decorator as a function, so the guard
 * reads exactly what a decorated controller would produce — no stubbed Reflector, no assertion
 * that a spy was called. Every expectation below is on the guard's actual result.
 */
class GuardedController {
  restricted(): void {}
  unguarded(): void {}
}

function decorate(method: 'restricted', roles: Role[]): void {
  const descriptor = Object.getOwnPropertyDescriptor(GuardedController.prototype, method);
  if (!descriptor) throw new Error(`no such method: ${method}`);
  Roles(...roles)(GuardedController.prototype, method, descriptor);
}

decorate('restricted', [Role.APPROVER, Role.INVENTORY_MANAGER]);

function contextFor(method: keyof GuardedController, user?: RequestUser): ExecutionContext {
  const handler = GuardedController.prototype[method];
  const request: { user?: RequestUser } = user ? { user } : {};
  return {
    getHandler: () => handler,
    getClass: () => GuardedController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function userWith(...roles: Role[]): RequestUser {
  return { id: 'user-id', email: 'someone@ims.test', roles };
}

function thrownBy(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected the guard to throw');
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('admits a user holding one of the required roles', () => {
    expect(guard.canActivate(contextFor('restricted', userWith(Role.GENERAL, Role.APPROVER)))).toBe(
      true,
    );
  });

  it('admits a user holding the other required role — the check is ANY, not ALL', () => {
    expect(
      guard.canActivate(contextFor('restricted', userWith(Role.GENERAL, Role.INVENTORY_MANAGER))),
    ).toBe(true);
  });

  it('admits a user holding both required roles, roles being additive', () => {
    expect(
      guard.canActivate(
        contextFor('restricted', userWith(Role.GENERAL, Role.APPROVER, Role.INVENTORY_MANAGER)),
      ),
    ).toBe(true);
  });

  it('rejects a user holding none of the required roles with FORBIDDEN', () => {
    const error = thrownBy(() => guard.canActivate(contextFor('restricted', userWith(Role.GENERAL))));

    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('rejects an unrelated role rather than falling through to allow', () => {
    const error = thrownBy(() =>
      guard.canActivate(contextFor('restricted', userWith(Role.GENERAL, Role.ADMIN))),
    );

    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects a request with no req.user as UNAUTHENTICATED, not FORBIDDEN', () => {
    const error = thrownBy(() => guard.canActivate(contextFor('restricted')));

    expect(error.code).toBe(ErrorCode.UNAUTHENTICATED);
    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('lets a handler with no @Roles metadata through — authentication is the global guard`s job', () => {
    expect(guard.canActivate(contextFor('unguarded'))).toBe(true);
  });
});
