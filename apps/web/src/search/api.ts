import { z } from 'zod';
import { api } from '../auth/api.ts';
export const SearchResponse = z.object({
  state: z.enum(['empty', 'short', 'ready']),
  total: z.number(),
  hasMore: z.boolean(),
  groups: z.array(
    z.object({
      type: z.enum(['note', 'object', 'object_event', 'document']),
      label: z.string(),
      items: z.array(
        z.object({
          type: z.enum(['note', 'object', 'object_event', 'document']),
          id: z.string(),
          targetId: z.string(),
          title: z.string(),
          snippet: z.string(),
          space: z.string(),
          visibility: z.enum(['personal', 'household', 'adults']),
          numbers: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type SearchResult = z.infer<typeof SearchResponse>;
export function fetchSearch(
  query: string,
  scope: 'all' | 'household' | 'personal',
  signal: AbortSignal,
) {
  return api(
    `search?${new URLSearchParams({ q: query, scope })}`,
    SearchResponse,
    undefined,
    signal,
  );
}
