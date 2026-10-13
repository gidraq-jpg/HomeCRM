import {
  AUDIENCES,
  CalendarDate,
  TaskFields,
  type TaskOverduePolicy,
  type TaskRepeatRule,
  TimeZone,
} from '@homecrm/shared';
import { z } from 'zod';
import { ApiError, type ApiMethod, apiRequest } from '../auth/api.ts';
import { RadarItem } from '../deadlines/api.ts';
import { FileMeta } from '../files/api.ts';
import { offlineOwnerAvailable } from '../offline/identity.ts';
import { durableMutation, durableTiming, type IntentForm } from '../offline/queue.ts';
import { snapshotPath, snapshotTiming } from '../offline/snapshots.ts';

export const TaskCard = TaskFields.extend({
  id: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  householdId: z.string().nullable(),
  hasOtherContributions: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  files: z.array(FileMeta),
  waitingFrom: z.object({ id: z.string(), title: z.string() }).nullable(),
  seriesId: z.string().nullable(),
  isMain: z.boolean(),
  doneAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  radarOccurrenceId: z.string().nullable(),
  completionEventId: z.string().nullable(),
  completionUndoneAt: z.string().nullable(),
  nextTaskId: z.string().nullable(),
  canRestore: z.boolean().optional(),
});
export type TaskCard = z.infer<typeof TaskCard>;
export type RepeatRule = z.infer<typeof TaskRepeatRule>;
export type OverduePolicy = z.infer<typeof TaskOverduePolicy>;
export const Today = z.object({
  householdId: z.string().nullable(),
  timeZone: TimeZone,
  today: CalendarDate,
  main: TaskCard.nullable(),
  tasks: z.array(TaskCard),
  completed: z.array(TaskCard),
  radar: z.array(RadarItem),
  recalculating: z.boolean(),
});
export const Plan = z.object({
  householdId: z.string().nullable(),
  timeZone: TimeZone,
  today: CalendarDate,
  from: z.string(),
  days: z.array(z.object({ date: z.string(), tasks: z.array(TaskCard) })),
  undated: z.array(TaskCard),
  nextCursor: z.string().nullable(),
});
const Failure = z.object({
  code: z.string().optional(),
  suggestedPlacement: z
    .object({ spaceId: z.string(), audience: z.enum(AUDIENCES) })
    .nullable()
    .optional(),
});
export class TaskError extends ApiError {
  readonly suggestedPlacement: z.infer<typeof Failure>['suggestedPlacement'];
  readonly intentId?: string;
  constructor(status: number, body: z.infer<typeof Failure>, intentId?: string) {
    super(status, body.code);
    this.suggestedPlacement = body.suggestedPlacement;
    this.intentId = intentId;
  }
}
/** Только дата сервера и монотонные часы: перевод часов браузера не продлевает отмену. */
export function undoWindow(
  doneAt: string | null,
  serverDate: string | null,
  elapsed: number,
): number {
  if (!doneAt || !serverDate) return 0;
  const remaining = 7000 - (Date.parse(serverDate) + 999 - Date.parse(doneAt)) - elapsed;
  return Number.isFinite(remaining) ? Math.max(0, Math.min(7000, remaining)) : 0;
}
export async function taskRequest<T>(
  method: ApiMethod,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  form?: IntentForm,
) {
  if (typeof indexedDB !== 'undefined' && (await offlineOwnerAvailable())) {
    if (method === 'GET' && snapshotPath(path)) {
      const data = await apiRequest(method, path, schema, body, signal);
      return {
        data,
        ...(snapshotTiming(data) ?? {
          serverDate: null,
          elapsed: 0,
          receivedAt: performance.now(),
        }),
      };
    }
    if (method !== 'GET') {
      try {
        const value = await durableMutation(method, path, body, form);
        if (value !== undefined) {
          // Квитанция уже проверена очередью; строгий DTO дела проверяется отдельно.
          const { receipt: _receipt, ...dto } = value as Record<string, unknown>;
          const data = schema.parse(dto);
          // Метка HTTP Date не сохранена: позднее подтверждение не продлевает семь секунд.
          return {
            data,
            ...(durableTiming(value) ?? {
              serverDate: null,
              elapsed: 0,
              receivedAt: performance.now(),
            }),
          };
        }
      } catch (error) {
        if (error instanceof Error && 'status' in error)
          throw new TaskError(
            Number(error.status),
            {
              code: 'code' in error ? String(error.code) : '',
            },
            'intentId' in error ? String(error.intentId) : undefined,
          );
        throw error;
      }
    }
  }
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new TaskError(0, { code: 'NETWORK' });
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = Failure.safeParse(json);
    throw new TaskError(response.status, failure.success ? failure.data : {});
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new TaskError(502, { code: 'INVALID_RESPONSE' });
  return {
    data: parsed.data,
    serverDate: response.headers.get('date'),
    elapsed: performance.now() - started,
    receivedAt: performance.now(),
  };
}
export async function fetchTask(id: string, signal?: AbortSignal) {
  const result = await taskRequest('GET', `tasks/${id}`, TaskCard, undefined, signal);
  return {
    ...result.data,
    undoUntil:
      result.receivedAt + undoWindow(result.data.doneAt, result.serverDate, result.elapsed),
  };
}
export type TimedTask = Awaited<ReturnType<typeof fetchTask>>;
export async function mutateTask(
  path: string,
  body: unknown,
  method: ApiMethod = 'POST',
  form?: IntentForm,
) {
  const result = await taskRequest(method, path, TaskCard, body, undefined, form);
  return {
    ...result.data,
    undoUntil:
      result.receivedAt + undoWindow(result.data.doneAt, result.serverDate, result.elapsed),
  };
}
export interface TaskFilters {
  filter?: 'mine' | 'assigned' | 'undated' | 'waiting';
  status?: TaskCard['status'];
  objectId?: string;
}
export const PAGE_SIZE = 50;
export function fetchTasks(
  scope: string,
  filters: TaskFilters,
  offset: number,
  trash = false,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
    scope,
    offset: String(offset),
    limit: String(PAGE_SIZE),
    trash: String(trash),
  });
  return apiRequest('GET', `tasks?${query}`, z.array(TaskCard), undefined, signal);
}
export function fetchToday(scope: string, householdId: string | null, signal?: AbortSignal) {
  return apiRequest(
    'GET',
    `tasks/today?${feedParams(scope, householdId)}`,
    Today,
    undefined,
    signal,
  );
}
export function fetchPlan(
  scope: string,
  householdId: string | null,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const params = feedParams(scope, householdId);
  if (cursor) params.set('cursor', cursor);
  return apiRequest('GET', `tasks/plan?${params}`, Plan, undefined, signal);
}
function feedParams(scope: string, householdId: string | null) {
  const params = new URLSearchParams({ scope });
  if (householdId) params.set('householdId', householdId);
  return params;
}
export const TaskHistory = z.array(
  z.object({
    id: z.string(),
    actor_id: z.string().nullable(),
    created_at: z.string(),
    changes: z.record(z.string(), z.unknown()),
  }),
);
export function fetchTaskHistory(id: string, signal?: AbortSignal) {
  return apiRequest('GET', `tasks/${id}/history`, TaskHistory, undefined, signal);
}
export async function seriesAction(id: string, action: 'trash' | 'restore') {
  return taskRequest('POST', `tasks/${id}/series/${action}`, z.array(TaskCard), {});
}
