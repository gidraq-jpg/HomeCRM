import { createHash } from 'node:crypto';
import {
  and,
  contacts,
  deadlines,
  eq,
  meters,
  objects,
  recordLinks,
  sql,
  templateApplications,
  utilityAccounts,
} from '@homecrm/db';
import {
  ApplyTemplate,
  canCreate,
  DeadlineRule,
  localDate,
  MeterData,
  OrganizationData,
  PropertyData,
  resolveMeterData,
  TEMPLATES,
  UtilityAccountData,
} from '@homecrm/shared';
import { z } from 'zod';
import {
  columnsOf,
  type DataRoute,
  deny,
  Failure,
  parse,
  placementFrom,
} from '../objects/support.ts';
import { createReading } from './meters.ts';
import { defaultHousePlacement, provider, validateProperty } from './service.ts';

// Порядок ключей JSON не меняет смысл повтора запроса.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function templateRoutes(route: DataRoute) {
  route('GET', '/api/templates', 200, async () => TEMPLATES);
  route('GET', '/api/onboarding', 200, async (tx, account) => {
    const houses = [...account.viewer.memberships]
      .filter(([, role]) => role === 'admin')
      .map(([id]) => id);
    const result = [];
    for (const id of houses) {
      const rows = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.spaceId, id), sql`${objects.deletedAt} IS NULL`))
        .limit(1);
      result.push({ householdId: id, empty: rows.length === 0 });
    }
    return { households: result, needsFirstObject: result.some((h) => h.empty) };
  });
  route('POST', '/api/templates/:id/apply', 201, async (tx, account, request) => {
    const { id } = parse(z.strictObject({ id: z.string() }), request.params);
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) throw new Failure(404, 'NOT_FOUND');
    const body = parse(ApplyTemplate, request.body);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`template:${account.id}:${body.idempotencyKey}`},0))`,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify(canonical({ id, body })))
      .digest('hex');
    const [previous] = await tx
      .select()
      .from(templateApplications)
      .where(
        and(
          eq(templateApplications.accountId, account.id),
          eq(templateApplications.key, body.idempotencyKey),
        ),
      );
    if (previous) {
      if (previous.requestHash !== hash) throw new Failure(409, 'IDEMPOTENCY_KEY_REUSED');
      const [visible] = previous.objectId
        ? await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, previous.objectId))
        : [];
      if (!visible) throw new Failure(409, 'TEMPLATE_RESULT_UNAVAILABLE');
      return { objectId: visible.id };
    }
    const place = body.placement
      ? await placementFrom(tx, account, body.placement.spaceId, body.placement.audience, 'adults')
      : await defaultHousePlacement(tx, account, 'adults');
    if (!canCreate(account.viewer, { type: 'object', placement: place, authorId: account.id }))
      deny();
    const house =
      place.kind === 'household'
        ? place.spaceId
        : (body.householdId ?? [...account.viewer.memberships.keys()].sort()[0]);
    if (house && !account.viewer.memberships.has(house)) deny();
    const zone = house
      ? ((
          await tx.execute<{ time_zone: string }>(
            sql`SELECT time_zone FROM spaces WHERE id=${house}::uuid`,
          )
        ).rows[0]?.time_zone ?? 'UTC')
      : 'UTC';
    const today = localDate(new Date(), zone);
    const common = { ...columnsOf(place), authorId: account.id };
    const [object] = await tx
      .insert(objects)
      .values({
        ...common,
        objectType: 'property',
        title: body.title,
        typeData: await validateProperty(
          tx,
          account,
          place,
          PropertyData.parse({ ...template.propertyData, ...body.propertyData }),
        ),
      })
      .returning();
    if (!object) deny();
    for (const selected of body.organizations) {
      const item = template.organizations.find((o) => o.id === selected);
      if (!item) throw new Failure(400, 'TEMPLATE_ITEM_UNAVAILABLE');
      // Организации общего объекта доступны всей семье (PRD 7.2).
      const [contact] = await tx
        .insert(contacts)
        .values({
          ...common,
          audience: place.kind === 'household' ? 'household' : null,
          title: item.title,
          kind: 'organization',
          data: OrganizationData.parse({ organizationType: item.organizationType }),
        })
        .returning();
      if (!contact) deny();
      await tx.insert(recordLinks).values({
        leftTable: 'objects',
        leftId: object.id,
        rightTable: 'contacts',
        rightId: contact.id,
        role: item.role,
        authorId: account.id,
      });
    }
    const accounts = new Map<string, string>();
    for (const selected of body.accounts) {
      const item = template.accounts.find((a) => a.id === selected.id);
      if (!item) throw new Failure(400, 'TEMPLATE_ITEM_UNAVAILABLE');
      const data = UtilityAccountData.parse({ ...item.data, ...selected.data });
      for (const key of ['readingRule', 'paymentRule'] as const)
        if (data[key]?.kind === 'repeat') data[key] = { ...data[key], anchor: today };
      await provider(tx, account, selected.supplierId ?? null);
      const [row] = await tx
        .insert(utilityAccounts)
        .values({
          ...common,
          parentId: object.id,
          title: selected.title ?? item.title,
          data,
          supplierId: selected.supplierId ?? null,
        })
        .returning();
      if (!row) deny();
      accounts.set(selected.id, row.id);
    }
    for (const selected of body.meters) {
      const item = template.meters.find((m) => m.id === selected.id);
      if (!item) throw new Failure(400, 'TEMPLATE_ITEM_UNAVAILABLE');
      const data = resolveMeterData(MeterData.parse({ ...item.data, ...selected.data }));
      const [row] = await tx
        .insert(meters)
        .values({
          ...common,
          parentId: object.id,
          utilityAccountId: accounts.get(item.accountId) ?? null,
          title: item.title,
          data,
        })
        .returning();
      if (!row) deny();
      if (selected.initialReading) await createReading(tx, account, row, selected.initialReading);
    }
    const selectedDeadlines = body.deadlines.map((selected) => {
      const item = template.deadlines.find((d) => d.id === selected.id);
      if (!item) throw new Failure(400, 'TEMPLATE_ITEM_UNAVAILABLE');
      return { ...item, rule: selected.rule ?? item.rule };
    });
    if (body.taxRegime) {
      const regime = template.taxRegimes.find((r) => r.id === body.taxRegime);
      if (!regime) throw new Failure(400, 'TEMPLATE_ITEM_UNAVAILABLE');
      selectedDeadlines.push(...regime.deadlines.map((d) => ({ ...d, selected: true })));
    }
    if (selectedDeadlines.length && !house) throw new Failure(400, 'HOUSE_REQUIRED');
    for (const item of selectedDeadlines) {
      const rule = DeadlineRule.parse(
        item.rule.kind === 'repeat' ? { ...item.rule, anchor: today } : item.rule,
      );
      await tx.insert(deadlines).values({
        ...common,
        objectId: object.id,
        householdId: house as string,
        assigneeId: object.assigneeId ?? account.id,
        label: item.title,
        rule,
      });
    }
    await tx.insert(templateApplications).values({
      accountId: account.id,
      key: body.idempotencyKey,
      requestHash: hash,
      objectId: object.id,
    });
    return { objectId: object.id };
  });
}
