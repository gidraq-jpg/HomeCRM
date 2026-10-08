import { UtilityAccountData } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import type { AccountCard } from './api.ts';
import {
  accountDraft,
  deriveTitle,
  emptyAccountDraft,
  supplierChange,
  toAccountInput,
  toggleService,
} from './form.ts';
import { describePayDay, describeTransmission, describeWindow } from './labels.ts';

const TODAY = '2026-10-08';

function card(data: Partial<UtilityAccountData> = {}): AccountCard {
  return {
    id: 'a',
    title: 'Электроэнергия',
    parentId: 'o',
    spaceId: 's',
    spaceKind: 'household',
    audience: 'adults',
    authorId: 'u',
    assigneeId: 'u',
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    deletedAt: null,
    data: UtilityAccountData.parse(data),
    supplierId: null,
    supplier: null,
    supplierHidden: false,
  };
}

describe('форма лицевого счёта', () => {
  it('пустая форма допустима: поставщик и номер необязательны', () => {
    const result = toAccountInput(emptyAccountDraft(), null, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('Лицевой счёт');
      expect(result.data).toEqual({
        services: [],
        number: '',
        transmission: null,
        readingRule: null,
        paymentRule: null,
        payer: 'owner',
        cabinetUrl: null,
        note: '',
      });
    }
  });

  it('окно «с 20 по 25» и день оплаты становятся ежемесячными правилами', () => {
    const result = toAccountInput(
      { ...emptyAccountDraft(), readFrom: '20', readTo: '25', payDay: '15' },
      null,
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = UtilityAccountData.parse(result.data);
    expect(parsed.readingRule).toMatchObject({
      kind: 'repeat',
      anchor: TODAY,
      durationDays: 0,
      repeat: { unit: 'month', every: 1, day: 20, endDay: 25 },
    });
    expect(parsed.paymentRule).toMatchObject({
      repeat: { unit: 'month', every: 1, day: 15 },
      durationDays: 0,
    });
    expect(describeWindow(parsed.readingRule)).toBe('с 20 по 25 числа');
    expect(describePayDay(parsed.paymentRule)).toBe('15-го числа каждого месяца');
  });

  it.each([null, card().data])(
    'новые правила не отправляют warnings и получают коммунальные умолчания: %s',
    (base) => {
      const result = toAccountInput(
        { ...emptyAccountDraft(), readFrom: '20', readTo: '25', payDay: '15' },
        base,
        TODAY,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.readingRule).not.toHaveProperty('warnings');
      expect(result.data.paymentRule).not.toHaveProperty('warnings');
      const parsed = UtilityAccountData.parse(result.data);
      expect(parsed.readingRule?.warnings).toEqual([0]);
      expect(parsed.paymentRule?.warnings).toEqual([3, 0]);
    },
  );

  it.each([[[]], [[2]]])('при изменении дней сохраняет прежние warnings: %j', (warnings) => {
    const original = card({
      readingRule: {
        kind: 'repeat',
        anchor: TODAY,
        warnings,
        repeat: { unit: 'month', every: 1, day: 20, endDay: 25 },
      } as never,
      paymentRule: {
        kind: 'repeat',
        anchor: TODAY,
        warnings,
        repeat: { unit: 'month', every: 1, day: 15 },
      } as never,
    });
    const result = toAccountInput(
      { ...accountDraft(original), readFrom: '21', payDay: '16' },
      original.data,
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.readingRule?.warnings).toEqual(warnings);
    expect(result.data.paymentRule?.warnings).toEqual(warnings);
  });

  it('окно через границу месяца: с 28 по 5 — на следующий месяц', () => {
    const result = toAccountInput(
      { ...emptyAccountDraft(), readFrom: '28', readTo: '5' },
      null,
      TODAY,
    );
    expect(result.ok && UtilityAccountData.safeParse(result.data).success).toBe(true);
    expect(result.ok && describeWindow(result.data.readingRule)).toBe(
      'с 28 по 5 числа следующего месяца',
    );
  });

  it('ошибки формата названы у поля: число 32, конец без начала, ссылка без схемы', () => {
    const result = toAccountInput(
      {
        ...emptyAccountDraft(),
        readFrom: '32',
        readTo: '',
        payDay: 'пятнадцатое',
        method: 'provider',
        providerUrl: 'ftp://x.example',
        cabinetUrl: 'javascript://x',
      },
      null,
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.readFrom).toContain('от 1 до 31');
      expect(result.errors.payDay).toContain('от 1 до 31');
      expect(result.errors.providerUrl).toContain('http');
      expect(result.errors.cabinetUrl).toContain('http');
    }
    const onlyEnd = toAccountInput({ ...emptyAccountDraft(), readTo: '25' }, null, TODAY);
    expect(!onlyEnd.ok && onlyEnd.errors.readFrom).toContain('с какого числа');
  });

  it('способ передачи: ссылка поставщика, телефон, без параметров', () => {
    const provider = toAccountInput(
      { ...emptyAccountDraft(), method: 'provider', providerUrl: 'supplier.invalid/pokazaniya' },
      null,
      TODAY,
    );
    expect(provider.ok && provider.data.transmission).toEqual({
      method: 'provider',
      url: 'https://supplier.invalid/pokazaniya',
    });
    const phone = toAccountInput(
      { ...emptyAccountDraft(), method: 'phone', phone: ' ' },
      null,
      TODAY,
    );
    expect(!phone.ok && phone.errors.phone).toContain('телефон');
    const auto = toAccountInput({ ...emptyAccountDraft(), method: 'automatic' }, null, TODAY);
    expect(auto.ok && auto.data.transmission).toEqual({ method: 'automatic' });
    expect(describeTransmission({ method: 'gosuslugi_dom' })).toBe('Госуслуги Дом');
    expect(describeTransmission(null)).toBe('не указан');
  });

  it('при правке введённое название не заменяется названием из услуг', () => {
    const original = { ...card({ services: ['electricity'] }), title: 'Лицевой счёт' };
    const draft = accountDraft(original);
    expect(draft.title).toBe('Лицевой счёт');
    const result = toAccountInput(draft, original.data, TODAY);
    expect(result.ok && result.title).toBe('Лицевой счёт');
    const renamed = toAccountInput({ ...draft, title: '  Свет  ' }, original.data, TODAY);
    expect(renamed.ok && renamed.title).toBe('Свет');
  });

  it('правило, которое человек не менял, сохраняется как есть вместе с якорем и временем', () => {
    const original = card({
      readingRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        time: '09:00',
        durationDays: 0,
        warnings: [2],
        repeat: { unit: 'month', every: 1, day: 20, endDay: 25 },
      } as never,
      payer: 'tenant',
    });
    const draft = { ...accountDraft(original), note: 'Новая заметка' };
    const result = toAccountInput(draft, original.data, TODAY);
    expect(result.ok && result.data.readingRule).toEqual(original.data.readingRule);
    expect(result.ok && result.data.payer).toBe('tenant');

    const moved = toAccountInput({ ...draft, readTo: '26' }, original.data, TODAY);
    expect(moved.ok && moved.data.readingRule).toMatchObject({
      anchor: '2026-01-01',
      time: '09:00',
      warnings: [2],
      repeat: { day: 20, endDay: 26 },
    });
  });

  it('название по умолчанию собирается из услуг', () => {
    expect(deriveTitle('', [])).toBe('Лицевой счёт');
    expect(deriveTitle('', ['electricity'])).toBe('Электроэнергия');
    expect(deriveTitle('', ['gas', 'heating', 'waste'])).toBe('Газ, Отопление и ещё 1');
    expect(deriveTitle('  Своё имя ', ['gas'])).toBe('Своё имя');
    expect(toggleService(['gas'], 'heating', true)).toEqual(['gas', 'heating']);
    expect(toggleService(['gas', 'heating'], 'gas', false)).toEqual(['heating']);
  });
});

describe('поставщик при правке', () => {
  it('скрытый поставщик (null от API) не стирается, пока человек не выбрал другого', () => {
    expect(supplierChange(null, '')).toEqual({});
    expect(supplierChange(null, 'org-1')).toEqual({ supplierId: 'org-1' });
  });

  it('видимый поставщик: без изменения ключа нет, замена и снятие — явные', () => {
    expect(supplierChange('org-1', 'org-1')).toEqual({});
    expect(supplierChange('org-1', 'org-2')).toEqual({ supplierId: 'org-2' });
    expect(supplierChange('org-1', '')).toEqual({ supplierId: null });
  });
});
