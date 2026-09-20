import { describe, expect, it } from 'vitest';
import { approverCountHint } from './approver-hint';

describe('approverCountHint', () => {
  it('says "approver", singular, when only one is required', () => {
    expect(approverCountHint(1, 15000)).toContain('1 approver ');
    expect(approverCountHint(1, 15000)).not.toContain('approvers');
  });

  it('says "approvers" for any other count', () => {
    expect(approverCountHint(2, 15000)).toContain('2 approvers');
  });

  /** Zero is not a count anyone should see, but "0 approver" would be worse than plural. */
  it('treats zero as plural', () => {
    expect(approverCountHint(0, 15000)).toContain('0 approvers');
  });

  it('formats the threshold with separators, as the page did before', () => {
    expect(approverCountHint(2, 15000)).toContain('15,000');
  });
});
