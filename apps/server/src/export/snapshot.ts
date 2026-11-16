// Выгрузка своих данных одним ответом JSON (POST /api/export). Архив с файлами — archive.ts.
// Все запросы идут в транзакции участника под RLS; что из видимого попадает в выгрузку,
// решают правила DATA-2 из @homecrm/shared.

import {
  accounts,
  deadlines,
  eq,
  memberProfiles,
  notes,
  notificationSettings,
  type Transaction,
} from '@homecrm/db';
import { canExportDeadline, canExportHouse, canView, NotificationSettings } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { card, placementOf } from '../notes/cards.ts';

/** Полный состав заметки в экспорте: своё личное и общее администрируемых домов (PRD 7.3.13). */
async function exportNotes(tx: Transaction, account: Account) {
  const visible = await tx.select().from(notes);
  return Promise.all(
    visible
      .filter(
        (record) =>
          canView(account.viewer, placementOf(record)) &&
          (record.spaceKind === 'personal' || canExportHouse(account.viewer, record.spaceId)),
      )
      .map((record) => card(tx, record, true)),
  );
}

/** Правила сроков: свои личные и общие администрируемых домов; чужой день рождения не выгружается. */
async function exportDeadlines(tx: Transaction, account: Account) {
  return (await tx.select().from(deadlines)).filter((rule) =>
    canExportDeadline(account.viewer, {
      placement: placementOf(rule),
      profileAccountId: rule.profileAccountId,
    }),
  );
}

export async function exportSnapshot(tx: Transaction, account: Account) {
  const [profile, mine, familyProfile] = await Promise.all([
    tx
      .select({ displayName: accounts.displayName, username: accounts.username })
      .from(accounts)
      .where(eq(accounts.id, account.id)),
    exportNotes(tx, account),
    tx.select().from(memberProfiles).where(eq(memberProfiles.accountId, account.id)),
  ]);
  const rules = await exportDeadlines(tx, account);
  const [settings] = await tx.select().from(notificationSettings);
  return {
    exportedAt: new Date().toISOString(),
    profile: profile[0] ? { ...profile[0], ...familyProfile[0] } : null,
    notes: mine,
    notificationSettings: NotificationSettings.strip().parse(settings ?? {}),
    deadlines: rules,
  };
}
