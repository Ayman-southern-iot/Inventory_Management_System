import { z } from 'zod';
import { paginationQuerySchema } from './common.js';

/**
 * What a project is currently doing with a borrowed item. Derived from `borrow_requests.status`,
 * never stored: RETURNED means the borrow is closed, IN_USE means units are still out.
 */
export const ProjectUsage = {
  IN_USE: 'IN_USE',
  RETURNED: 'RETURNED',
} as const;
export type ProjectUsage = (typeof ProjectUsage)[keyof typeof ProjectUsage];

export const projectUsageSchema = z.enum(
  Object.values(ProjectUsage) as [ProjectUsage, ...ProjectUsage[]],
);

/**
 * One borrow, as it appears under a project. One row per borrow rather than per product,
 * because the tag is a property of the borrow: the same product can be part returned and
 * part still out, and a single row could not carry both truthfully.
 */
export const projectItemSchema = z.object({
  borrowRequestId: z.string().uuid(),
  borrowNo: z.string(),
  productId: z.string().uuid(),
  productCode: z.string(),
  productName: z.string(),
  /** As borrowed. */
  quantity: z.number().int(),
  returnedQty: z.number().int(),
  /** quantity - returnedQty. The number that matters when hunting for the item. */
  outstandingQty: z.number().int(),
  usage: projectUsageSchema,
  borrowerName: z.string(),
  purpose: z.string().nullable(),
  expectedReturnDate: z.string().nullable(),
  issuedAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
});
export type ProjectItem = z.infer<typeof projectItemSchema>;

export const listProjectItemsQuerySchema = paginationQuerySchema.extend({
  /** Absent means both. Filtering server-side keeps it correct across pages. */
  usage: projectUsageSchema.optional(),
});
export type ListProjectItemsQuery = z.infer<typeof listProjectItemsQuerySchema>;

export const projectDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  inUseCount: z.number().int(),
  returnedCount: z.number().int(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
