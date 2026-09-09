import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@agro/shared";
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  search: z.string().max(200).optional()
}).passthrough();
export type PageQueryInput = z.infer<typeof pageQuerySchema>;
export function extractFilters(q: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(q)) {
    if (["page", "pageSize", "sort", "dir", "search"].includes(k)) continue;
    if (typeof v === "string" && v !== "") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.map(String);
  }
  return out;
}
