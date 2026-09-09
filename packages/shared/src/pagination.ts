export interface PageQuery {
  page: number;
  pageSize: number;
  sort?: string;
  dir?: "asc" | "desc";
  search?: string;
  filters: Record<string, string | string[] | undefined>;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totals?: Record<string, string>;
}
export const PAGE_SIZES = [10, 20, 30, 50, 80, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;
