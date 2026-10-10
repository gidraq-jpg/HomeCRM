import { z } from 'zod';
import { CalendarDate } from './deadlines.ts';
import { TaskOverduePolicy, TaskRepeatRule } from './task-repeats.ts';

export const TASK_STATUSES = ['open', 'done', 'cancelled', 'not_done', 'waiting'] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export const TaskChecklist = z
  .array(
    z.strictObject({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500),
      done: z.boolean(),
      position: z.number().int().min(0).max(1000),
    }),
  )
  .max(100)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);
export const TaskClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const TaskFields = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).default(''),
  repeatRule: TaskRepeatRule.nullable().default(null),
  overduePolicy: TaskOverduePolicy.default('keep'),
  planOn: CalendarDate.nullable().default(null),
  planTime: TaskClock.nullable().default(null),
  dueOn: CalendarDate.nullable().default(null),
  dueTime: TaskClock.nullable().default(null),
  status: TaskStatus.default('open'),
  waitingContactId: z.uuid().nullable().default(null),
  waitingAccountId: z.uuid().nullable().default(null),
  checkOn: CalendarDate.nullable().default(null),
  checklist: TaskChecklist.default([]),
});
export type TaskChecklist = z.infer<typeof TaskChecklist>;
export type TaskFields = z.infer<typeof TaskFields>;
/** Проверяется и после частичной правки, по итоговым полям. */
export const TaskDataWithMissingTarget = TaskFields.refine(
  (task) =>
    (!task.repeatRule || !!task.planOn) &&
    (!task.planTime || !!task.planOn) &&
    (!task.dueTime || !!task.dueOn) &&
    !(task.waitingContactId && task.waitingAccountId) &&
    (task.status !== 'waiting' || !!task.checkOn),
);
export const TaskData = TaskDataWithMissingTarget.refine(
  (task) => task.status !== 'waiting' || !!(task.waitingContactId || task.waitingAccountId),
);
