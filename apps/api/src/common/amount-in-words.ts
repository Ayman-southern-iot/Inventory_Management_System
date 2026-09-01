/**
 * A money amount written out, for documents that are paid against.
 *
 * On anything Accounts acts on, the figure in words is the one that settles a dispute: digits can
 * be altered on a printout with a pen, and a misplaced comma is invisible. The words are there to
 * disagree loudly when that happens.
 *
 * **Bangladeshi grouping**, not Western: 1,00,000 is one lakh and 1,00,00,000 is one crore. A
 * naive thousand/million/billion scale would print "one hundred thousand" on a document read by
 * people who count in lakh, which is both wrong-looking and slower to check against the digits
 * beside it.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** Under a thousand, which is the largest group any Indian-system scale needs at once. */
function underThousand(value: number): string {
  if (value === 0) return '';
  if (value < 20) return ONES[value]!;
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]!;
    const ones = ONES[value % 10]!;
    return ones ? `${tens}-${ones}` : tens;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]!} Hundred`;
  const rest = underThousand(value % 100);
  return rest ? `${hundreds} ${rest}` : hundreds;
}

/**
 * The whole-number part, grouped crore / lakh / thousand / hundred.
 *
 * Capped at 999,99,99,999 — beyond that this office has bigger problems than a PDF, and silently
 * printing a wrong word on a payable document is worse than refusing to.
 */
function wholeInWords(value: number): string {
  if (value === 0) return 'Zero';

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1_000);
  const rest = value % 1_000;

  if (crore > 0) parts.push(`${underThousand(crore)} Crore`);
  if (lakh > 0) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest > 0) parts.push(underThousand(rest));

  return parts.join(' ');
}

/**
 * `1500.5` → `Taka One Thousand Five Hundred and Fifty Poisha Only`.
 *
 * Poisha are rendered as a whole number of hundredths, the way a cheque is written, rather than as
 * a decimal read out digit by digit. Rounded to the cent first so the words can never disagree
 * with the figure printed beside them — which is the entire reason for putting them on the page.
 */
export function amountInWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';

  const rounded = Math.round(value * 100);
  const whole = Math.floor(rounded / 100);
  const poisha = rounded % 100;

  // 999,99,99,999.99 — the largest the crore grouping above states correctly.
  if (whole > 9_999_999_999) return '';

  const takaWords = `Taka ${wholeInWords(whole)}`;
  if (poisha === 0) return `${takaWords} Only`;
  return `${takaWords} and ${underThousand(poisha)} Poisha Only`;
}
