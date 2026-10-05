import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ims/shared';
import { DomainError } from '../../common/errors';

/** Still 409; the code lets the SPA say what clashed instead of a sentence that fits every conflict. */
export class DuplicateDepartmentNameError extends DomainError {
  constructor() {
    super(ErrorCode.DUPLICATE_DEPARTMENT_NAME, 'A department with that name already exists', HttpStatus.CONFLICT);
  }
}

/** Deactivating would orphan the people in it, so it is refused until they are moved. */
export class DepartmentHasActiveUsersError extends DomainError {
  constructor(count: number) {
    super(
      ErrorCode.DEPARTMENT_HAS_ACTIVE_USERS,
      `Move the ${count} active user${count === 1 ? '' : 's'} out of this department before deactivating it`,
      HttpStatus.CONFLICT,
      { count },
    );
  }
}
