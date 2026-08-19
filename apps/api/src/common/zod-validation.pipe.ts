import { type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';
import { type FieldIssue } from '@ims/shared';
import { ValidationFailedError } from './errors';

function toFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parses one request body/query/param through a zod schema at the controller boundary.
 * An unvalidated value reaching a service is a bug (rules/20-backend.md), so the return type
 * is the schema's inferred type — services take parsed input, never `any`.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ValidationFailedError(toFieldIssues(result.error));
    return result.data;
  }
}

export const zodPipe = <T>(schema: ZodType<T>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
