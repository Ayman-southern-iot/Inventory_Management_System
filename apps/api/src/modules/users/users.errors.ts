import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { DomainError } from '../../common/errors';

/**
 * Both were a bare `ConflictError`. The user form can only answer a bare CONFLICT with a sentence
 * that fits every conflict, which is wrong for these two: one is a typo to fix, the other is a
 * rule that protects everyone's access. Still 409.
 */
export class DuplicateUserEmailError extends DomainError {
  constructor() {
    super(ErrorCode.USER_EMAIL_IN_USE, 'A user with that email already exists', HttpStatus.CONFLICT);
  }
}

/** Removing or deactivating the last reachable administrator would lock everyone out. */
export class LastAdministratorError extends DomainError {
  constructor() {
    super(
      ErrorCode.LAST_ADMINISTRATOR,
      'This is the last active administrator and cannot be removed',
      HttpStatus.CONFLICT,
    );
  }
}
