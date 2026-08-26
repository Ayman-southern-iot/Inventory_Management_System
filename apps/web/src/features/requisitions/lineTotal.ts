import { requisitionItemInputSchema } from '@ims/shared';

const { quantity: quantitySchema, estimatedUnitPrice: priceSchema } =
  requisitionItemInputSchema.shape;

/**
 * D-017. The form multiplied whatever was in the two boxes, so a quantity of -5 at a unit price
 * of -1000 displayed a confident 5,000.00 line total, and 99,999,999,999 was totalled and shown
 * before submit rejected it. Both are arithmetic on input the API will refuse, and the negative
 * case is the dangerous one: two invalid numbers multiply into a plausible positive.
 *
 * Validity is asked of the shared schema rather than re-stated here, per `rules/30-frontend.md`
 * ("the same zod schema the API uses"). If the bounds move, this follows without an edit, and
 * there is no second definition of what a costable line is to drift out of step.
 *
 * Returns null, never 0, so a caller can tell "not costable yet" from "genuinely free".
 */
export function lineTotalOf(quantity: unknown, unitPrice: unknown): number | null {
  const parsedQuantity = quantitySchema.safeParse(quantity);
  const parsedPrice = priceSchema.safeParse(unitPrice);

  return parsedQuantity.success && parsedPrice.success
    ? parsedQuantity.data * parsedPrice.data
    : null;
}
