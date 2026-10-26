import { DraftSchemas, ReceiptAccounts } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, apiRequest } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { createCharge } from '../charges/api.ts';
import { ChargeForm } from '../charges/ChargeForm.tsx';
import { defaultPeriod } from '../charges/form.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { fetchMeters, MeterCard, ReadingCard } from '../meters/api.ts';
import { MeterField } from '../meters/ReadingsEntry.tsx';
import type { ReadingsContext } from '../meters/ReadingsLayout.tsx';
import { evaluateMeter, type ReadingDraft } from '../meters/readings.ts';
import { todayIn } from '../objects/dates.ts';
import { useObjectCard } from '../objects/queries.ts';
import { useNavigate } from '../shell/motion.tsx';
import { type InboxItem, inboxOperationKey } from './api.ts';

type Complete = (target: { type: 'meter_reading' | 'utility_charge'; id: string }) => Promise<void>;
export function InboxUtilities({
  row,
  kind,
  onCreated,
}: {
  row: InboxItem;
  kind: 'meter' | 'receipt';
  onCreated: Complete;
}) {
  return kind === 'meter' ? (
    <InboxReading row={row} onCreated={onCreated} />
  ) : (
    <InboxCharge row={row} onCreated={onCreated} />
  );
}
function InboxCharge({ row, onCreated }: { row: InboxItem; onCreated: Complete }) {
  const { me } = useHousehold();
  const state = useAction();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(
    row.draft?.classification.kind === 'receipt'
      ? (DraftSchemas.receipt.parse(row.draft.fields).accountId.value ?? '')
      : '',
  );
  const accounts = useQuery({
    queryKey: ['inbox-accounts', me.id, row.houseId],
    enabled: !!row.houseId,
    queryFn: () => apiRequest('GET', `ai/receipt-accounts?spaceId=${row.houseId}`, ReceiptAccounts),
  });
  const account = accounts.data?.find((a) => a.id === selected);
  const object = useObjectCard(account?.objectId);
  const initial = DraftSchemas.receipt.safeParse(row.draft?.fields);
  const created = useRef<string | null>(null);
  return (
    <>
      <div className="field">
        <label htmlFor="inbox-account" className="field__label">
          Объект и лицевой счёт — проверьте
        </label>
        <select
          id="inbox-account"
          className="select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Выберите счёт</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.objectTitle} · {a.title} · {a.data.number}
            </option>
          ))}
        </select>
      </div>
      {accounts.isError ? (
        <Notice error>Не удалось загрузить счета. Повторите при появлении сети.</Notice>
      ) : null}
      {account && object.data ? (
        <ChargeForm
          key={account.id}
          card={object.data}
          account={account}
          period={defaultPeriod(todayIn(me.timeZone))}
          today={todayIn(me.timeZone)}
          state={state}
          {...(initial.success ? { initial: initial.data } : {})}
          onCancel={() => navigate(`/more/inbox/${row.id}`)}
          onSubmit={(value, accountId) =>
            state.run(async () => {
              const id =
                created.current ??
                (
                  await createCharge(accountId, {
                    ...value,
                    idempotencyKey: await inboxOperationKey(row.id, 'receipt'),
                  })
                ).id;
              created.current = id;
              await onCreated({ type: 'utility_charge', id });
            })
          }
        />
      ) : null}
    </>
  );
}
function InboxReading({ row, onCreated }: { row: InboxItem; onCreated: Complete }) {
  const { me } = useHousehold();
  const state = useAction();
  const [meterId, setMeterId] = useState(row.draft?.classification.meterId.value ?? '');
  const options = useQuery({
    queryKey: ['inbox-meter-options', me.id],
    queryFn: () =>
      apiRequest(
        'GET',
        'inbox/meters',
        z.array(
          z.object({
            id: z.uuid(),
            title: z.string(),
            objectId: z.uuid(),
            objectTitle: z.string(),
          }),
        ),
      ),
  });
  const meter = useQuery({
    queryKey: ['inbox-meter', me.id, meterId],
    enabled: !!meterId,
    queryFn: () => apiRequest('GET', `meters/${meterId}`, MeterCard),
  });
  const object = useObjectCard(meter.data?.parentId);
  const meters = useQuery({
    queryKey: ['inbox-meters', me.id, meter.data?.parentId],
    enabled: !!meter.data,
    queryFn: () => fetchMeters(meter.data?.parentId ?? '', 'all'),
  });
  const initial = DraftSchemas.meter.safeParse(row.draft?.fields);
  const [value, setValue] = useState<ReadingDraft>({
    values: initial.success ? initial.data.values.map((f) => f.value ?? '') : [],
    rollover: false,
  });
  const [date, setDate] = useState<string>(todayIn(me.timeZone));
  const [problem, setProblem] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const created = useRef<string | null>(null);
  if (!meterId)
    return (
      <div className="field">
        <label className="field__label" htmlFor="inbox-meter">
          Объект и счётчик — выберите вручную
        </label>
        <select
          className="select"
          id="inbox-meter"
          value={meterId}
          onChange={(e) => setMeterId(e.target.value)}
        >
          <option value="">Выберите счётчик</option>
          {options.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.objectTitle} · {m.title}
            </option>
          ))}
        </select>
        {options.isError ? (
          <Notice error>Не удалось загрузить счётчики. Повторите при появлении сети.</Notice>
        ) : null}
      </div>
    );
  if (!meter.data || !object.data)
    return (
      <Notice>
        {meter.isError || object.isError
          ? 'Счётчик недоступен. Исходное осталось во входящих.'
          : 'Загружаем счётчик…'}
      </Notice>
    );
  const card = meter.data;
  const entry = meters.data?.find((m) => m.id === card.id) ?? { ...card, previousReading: null };
  const context: ReadingsContext = {
    card: object.data,
    canWrite: true,
    today: todayIn(me.timeZone),
    meters: [entry],
    allMeters: [entry],
    metersLoading: false,
    date,
    setDate,
    drafts: { [card.id]: value },
    setDraft: (_id, next) => setValue(next),
    files: {},
    setFiles: () => {},
    uploaded: {},
    setUploaded: () => {},
    saved: null,
    setSaved: () => {},
    prefill: (_id, next) => setValue(next),
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        void state.run(async () => {
          const result = evaluateMeter(entry, value);
          if (!result.valid) throw new ApiError(400, 'INVALID_INPUT');
          const id =
            created.current ??
            (
              await apiRequest('POST', `meters/${card.id}/readings`, ReadingCard, {
                occurredOn: date,
                values: result.values,
                rollover: value.rollover,
                comment: '',
                idempotencyKey: await inboxOperationKey(row.id, 'meter'),
              })
            ).id;
          created.current = id;
          await onCreated({ type: 'meter_reading', id });
        });
      }}
    >
      <p>
        Объект: {object.data.title} · счётчик: {card.title}
      </p>
      <p className="muted">Показание и фото будут видны тем, кому доступен объект.</p>
      <div className="field">
        <label htmlFor="inbox-reading-date" className="field__label">
          Дата показаний
        </label>
        <input
          id="inbox-reading-date"
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <ul className="inbox-list">
        <MeterField
          meter={entry}
          ctx={context}
          submitted={submitted}
          photoProblem={problem || undefined}
          onPhotoProblem={(p) => setProblem(p ?? '')}
          showPhotos={false}
        />
      </ul>
      {state.error ? (
        <Notice error>
          Показание не сохранено. Проверьте дату, значение и переход через ноль. Исходное осталось
          во входящих.
        </Notice>
      ) : null}
      <button className="btn btn--primary" type="submit" disabled={state.pending}>
        Сохранить как предложено
      </button>
    </form>
  );
}
