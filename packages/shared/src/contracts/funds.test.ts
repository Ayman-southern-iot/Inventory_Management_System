import { describe, expect, it } from 'vitest';
import { recordFundReceiptSchema, recordPurchaseSchema } from './funds.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function receipt(receivedAt: string) {
  return { amount: 5000, receivedAt };
}

function purchase(purchasedAt: string) {
  return {
    vendor: 'Techshop BD',
    purchasedAt,
    lines: [{ requisitionItemId: '11111111-1111-4111-8111-111111111111', quantity: 1, unitCost: 4800 }],
  };
}

/** The message the caller is shown, not just "Invalid input" — QA round 1, item 5d. */
function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.message);
}

/**
 * QA round 1, item 5d. Both fields are *event* dates — when Accounts released the money, when
 * the goods were bought — so they are routinely entered days after the fact and backdating has
 * to stay open. The future is the direction that is always a typo: a receipt dated 2027 lands
 * in the expense report for a month that has not happened.
 */
describe('funds contracts — event dates cannot be in the future', () => {
  describe('recordFundReceiptSchema.receivedAt', () => {
    it('refuses a date in the future, and says so', () => {
      const result = recordFundReceiptSchema.safeParse(
        receipt(new Date(Date.now() + DAY_MS).toISOString()),
      );

      expect(result.success).toBe(false);
      expect(messages(result)).toContain('The date funds were received cannot be in the future');
    });

    it('accepts a backdated receipt — a year late is still a real receipt', () => {
      const result = recordFundReceiptSchema.safeParse(
        receipt(new Date(Date.now() - 365 * DAY_MS).toISOString()),
      );

      expect(result.success).toBe(true);
    });

    it('accepts now', () => {
      expect(recordFundReceiptSchema.safeParse(receipt(new Date().toISOString())).success).toBe(true);
    });
  });

  describe('recordPurchaseSchema.purchasedAt', () => {
    it('refuses a date in the future, and says so', () => {
      const result = recordPurchaseSchema.safeParse(
        purchase(new Date(Date.now() + DAY_MS).toISOString()),
      );

      expect(result.success).toBe(false);
      expect(messages(result)).toContain('The purchase date cannot be in the future');
    });

    it('accepts a backdated purchase', () => {
      const result = recordPurchaseSchema.safeParse(
        purchase(new Date(Date.now() - 30 * DAY_MS).toISOString()),
      );

      expect(result.success).toBe(true);
    });
  });

  /**
   * A browser clock a minute fast must not refuse an otherwise valid entry. The dialog sends
   * local midnight of the chosen day, so this only ever matters to another client — but the
   * failure mode is a support ticket nobody can reproduce.
   */
  it('tolerates a small clock skew rather than refusing a valid entry', () => {
    const result = recordFundReceiptSchema.safeParse(
      receipt(new Date(Date.now() + 60_000).toISOString()),
    );

    expect(result.success).toBe(true);
  });
});
