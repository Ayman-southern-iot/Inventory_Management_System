import { describe, expect, it } from 'vitest';
import { humanizeValidationMessage } from './validation-message';

/**
 * Message audit M2. Raw library wording ("String must contain at least 2 character(s)",
 * "Invalid uuid") reached users from two places: the browser's own form validation and the
 * server's `FieldIssue.message`. Both are zod's default English, so one function turns the default
 * wording into plain sentences and leaves any sentence somebody wrote on purpose alone.
 */
describe('humanizeValidationMessage', () => {
  const table: Array<[string, string]> = [
    ['Required', 'Required'],
    ['String must contain at least 1 character(s)', 'Required'],
    ['String must contain at least 2 character(s)', 'Use at least 2 characters.'],
    ['String must contain at least 4 character(s)', 'Use at least 4 characters.'],
    ['String must contain at most 80 character(s)', 'Use no more than 80 characters.'],
    ['String must contain exactly 6 character(s)', 'Use exactly 6 characters.'],
    ['Number must be greater than 0', 'Enter a number greater than 0.'],
    ['Number must be greater than or equal to 0', 'Enter 0 or more.'],
    ['Number must be greater than or equal to 1', 'Enter 1 or more.'],
    ['Number must be less than 5', 'Enter a number less than 5.'],
    ['Number must be less than or equal to 100', 'Enter 100 or less.'],
    ['Expected number, received nan', 'Enter a number.'],
    ['Invalid email', 'Enter a valid email address.'],
    ['Invalid uuid', 'Choose an option.'],
    ['Invalid url', 'Enter a valid web address.'],
    ["Invalid enum value. Expected 'LOW' | 'HIGH', received 'x'", 'Choose one of the available options.'],
    ['Invalid date', 'Enter a valid date.'],
    ['Invalid input', 'This value is not valid.'],
    ['Array must contain at least 1 element(s)', 'Add at least one item.'],
    ['Array must contain at least 3 element(s)', 'Add at least 3 items.'],
    ['Array must contain at most 2 element(s)', 'Add no more than 2 items.'],
  ];

  it.each(table)('turns %j into %j', (raw, expected) => {
    expect(humanizeValidationMessage(raw)).toBe(expected);
  });

  it('leaves a sentence somebody wrote on purpose exactly as it is', () => {
    const authored = 'That file type is not accepted. Upload a PNG, JPEG or PDF.';
    expect(humanizeValidationMessage(authored)).toBe(authored);
    expect(humanizeValidationMessage('An expected return date is required')).toBe(
      'An expected return date is required',
    );
  });

  it('never leaves zod wording behind for any message in the table', () => {
    for (const [raw] of table) {
      expect(humanizeValidationMessage(raw)).not.toMatch(/character\(s\)|element\(s\)|Invalid |Number must/);
    }
  });

  it('trims surrounding whitespace', () => {
    expect(humanizeValidationMessage('  Invalid uuid  ')).toBe('Choose an option.');
  });

  describe('with a field path (for a toast, where nothing is highlighted)', () => {
    it('names the field when it is known', () => {
      expect(humanizeValidationMessage('Required', 'lines.0.newProduct.productCode')).toBe(
        'Storage ID is required.',
      );
      expect(humanizeValidationMessage('String must contain at least 1 character(s)', 'productCode')).toBe(
        'Storage ID is required.',
      );
      expect(humanizeValidationMessage('Invalid uuid', 'compartmentId')).toBe(
        'Compartment: Choose an option.',
      );
      expect(humanizeValidationMessage('Number must be greater than 0', 'quantity')).toBe(
        'Quantity: Enter a number greater than 0.',
      );
    });

    it('says nothing about a field it does not know, or a generic one', () => {
      expect(humanizeValidationMessage('Invalid uuid', 'somethingInternal')).toBe('Choose an option.');
      expect(humanizeValidationMessage('Number must be greater than or equal to 0', 'value')).toBe(
        'Enter 0 or more.',
      );
    });

    it('does not prefix a sentence somebody wrote on purpose', () => {
      expect(humanizeValidationMessage('Amount returned must not exceed the unspent amount', 'amountReturned')).toBe(
        'Amount returned must not exceed the unspent amount',
      );
    });
  });
});
