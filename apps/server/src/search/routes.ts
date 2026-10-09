import { searchAccessKeys, setSearchQuery } from '@homecrm/db';
import { canView } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthModule } from '../auth/routes.ts';
import { dataRoutes, parse } from '../objects/support.ts';
import { searchRowsQuery } from './query.ts';
import { searchSnippet } from './snippet.ts';

const Query = z.object({
  q: z.string().trim().max(200).default(''),
  scope: z.enum(['all', 'household', 'personal']).default('all'),
});
const labels = {
  note: 'Заметки',
  object: 'Объекты',
  object_event: 'События',
  document: 'Документы',
  contact: 'Люди и организации',
} as const;
interface Hit extends Record<string, unknown> {
  source_type:
    | 'note'
    | 'note_item'
    | 'object'
    | 'object_field'
    | 'object_event'
    | 'meter'
    | 'document'
    | 'contact';
  source_id: string;
  target_id: string;
  title: string;
  content: string;
  snippet: string;
  space_id: string;
  space_kind: 'personal' | 'household';
  audience: 'household' | 'adults' | null;
  owner_id: string | null;
}
const typeOf = (hit: Hit): keyof typeof labels =>
  hit.source_type === 'note_item'
    ? 'note'
    : hit.source_type === 'object_field' || hit.source_type === 'meter'
      ? 'object'
      : hit.source_type;

export async function searchRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('GET', '/api/search', 200, async (tx, account, request) => {
    const { q, scope } = parse(Query, request.query);
    if (q.length < 3)
      return { state: q.length === 0 ? 'empty' : 'short', groups: [], total: 0, hasMore: false };
    await setSearchQuery(tx, q);
    const keys = await searchAccessKeys(tx, account.viewer);
    // RLS отбирает доступ и совпадения до счётчиков, лимита и формирования фрагментов.
    const { rows } = await tx.execute<Hit>(searchRowsQuery(q, scope, keys));
    // Второй рубеж, как у модулей записей. Время и число скрытых строк не возвращаются.
    const visible = rows.filter((hit) =>
      canView(
        account.viewer,
        hit.space_kind === 'personal'
          ? { kind: 'personal', spaceId: hit.space_id, ownerId: hit.owner_id ?? '' }
          : { kind: 'household', spaceId: hit.space_id, audience: hit.audience ?? 'household' },
      ),
    );
    const limited = visible.slice(0, 150);
    const groups = Object.entries(labels)
      .map(([type, label]) => ({
        type,
        label,
        items: limited
          .filter((hit) => typeOf(hit) === type)
          .map((hit) => ({
            type,
            id: hit.source_id,
            targetId: hit.target_id,
            title: hit.title,
            snippet: searchSnippet(hit.content, hit.snippet, q),
            space:
              hit.space_kind === 'personal'
                ? 'Личное'
                : hit.audience === 'adults'
                  ? 'Общее · Взрослые'
                  : 'Общее · Вся семья',
            visibility: hit.space_kind === 'personal' ? 'personal' : (hit.audience ?? 'household'),
            numbers: [
              ...new Set(
                (hit.source_type === 'object_field'
                  ? [hit.content.slice(hit.title.length).trim()]
                  : (hit.content.match(/\+?\d[\d\s().-]*\d/g) ?? [])
                )
                  .map((value) => value.trim())
                  .filter((value) => value.replace(/\D/g, '').length >= 3),
              ),
            ].slice(0, 5),
          })),
      }))
      .filter((group) => group.items.length > 0);
    return { state: 'ready', groups, total: limited.length, hasMore: visible.length > 150 };
  });
}
