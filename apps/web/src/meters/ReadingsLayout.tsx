import { ArrowsLeftRight } from '@phosphor-icons/react';
import { createContext, useContext, useMemo, useState } from 'react';
import { Outlet, useParams } from 'react-router';
import { Notice } from '../auth/components.tsx';
import { useRadar } from '../deadlines/useRadar.ts';
import { openWindowObjectIds } from '../deadlines/utility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf } from '../notes/abilities.ts';
import { objectAbilities } from '../objects/abilities.ts';
import type { ObjectCard, ObjectSummary } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { todayIn } from '../objects/dates.ts';
import { useObjectCard, useObjectsList } from '../objects/queries.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { Page } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import type { MeterListItem, ReadingCard } from './api.ts';
import { useMeters } from './queries.ts';
import type { ReadingDraft } from './readings.ts';

// Экран «Показания» (UTIL-7, S3). Название объекта в заголовке крупно: на прототипе посторонний
// человек ошибся квартирой. Черновик живёт только в памяти этого экрана: в localStorage,
// адрес и кэш сервис-воркера ни значения, ни фото не попадают.

/** Что сохранено «Сохранить всё»: показания с расходом и предупреждениями, пока их не передали. */
export interface SavedBatch {
  readings: ReadingCard[];
}

export interface ReadingsContext {
  card: ObjectCard;
  /** Можно ли вводить показания и отмечать передачу. */
  canWrite: boolean;
  today: string;
  /** Работающие счётчики объекта. */
  meters: MeterListItem[];
  /** Все счётчики, включая заменённые и снятые: по ним подписываются старые показания. */
  allMeters: MeterListItem[];
  metersLoading: boolean;
  date: string;
  setDate: (date: string) => void;
  drafts: Record<string, ReadingDraft>;
  setDraft: (meterId: string, draft: ReadingDraft) => void;
  files: Record<string, File[]>;
  setFiles: (meterId: string, files: File[]) => void;
  /** Фото, уже загруженные в объект до неудачного сохранения: повторно их не отправляем. */
  uploaded: Record<string, string[]>;
  setUploaded: (value: Record<string, string[]>) => void;
  saved: SavedBatch | null;
  setSaved: (value: SavedBatch | null) => void;
  /** Вернуть значение в форму ввода (исправление последнего показания). */
  prefill: (meterId: string, draft: ReadingDraft) => void;
}

const Context = createContext<ReadingsContext | null>(null);

export function useReadings(): ReadingsContext {
  const value = useContext(Context);
  if (value === null) throw new Error('Экран «Показания» работает только внутри ReadingsLayout');
  return value;
}

/** Выбор другой недвижимости: сначала объекты с открытым окном показаний, затем остальные. */
function SwitchObject({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
        <ArrowsLeftRight size={20} aria-hidden />
        Другой объект
      </button>
      {open ? <SwitchSheet currentId={currentId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SwitchRows({ label, objects }: { label: string; objects: readonly ObjectSummary[] }) {
  return (
    <RowList label={label}>
      {objects.map((object) => (
        <Row
          key={object.id}
          to={`/home/${object.id}/readings`}
          title={
            <>
              {object.title}
              {object.typeData.status ? (
                <span className="row__status">
                  <PropertyStatusBadge status={object.typeData.status} />
                </span>
              ) : null}
            </>
          }
          {...(object.typeData.address ? { meta: object.typeData.address } : {})}
        />
      ))}
    </RowList>
  );
}

function SwitchSheet({ currentId, onClose }: { currentId: string; onClose: () => void }) {
  const query = useObjectsList(false);
  const radar = useRadar({ poll: false });
  const others = (query.data?.pages.flat() ?? []).filter(
    (object) => object.objectType === 'property' && object.id !== currentId,
  );
  const open = openWindowObjectIds(radar.rows);
  const withWindow = others.filter((object) => open.has(object.id));
  const rest = others.filter((object) => !open.has(object.id));
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Другой объект"
      description="Выберите недвижимость, по которой вводите показания. Сначала идут объекты с открытым окном показаний. Название объекта всегда стоит в заголовке экрана."
    >
      {query.isPending ? <Notice>Загружаем объекты…</Notice> : null}
      {query.isError ? <ObjectError error={query.error} action="load" /> : null}
      {query.data && others.length === 0 ? (
        <p className="muted sheet__block">Других объектов недвижимости пока нет.</p>
      ) : null}
      {withWindow.length > 0 ? (
        <>
          <p className="sheet__label">Открыто окно показаний</p>
          <SwitchRows label="Недвижимость с открытым окном" objects={withWindow} />
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          {withWindow.length > 0 ? <p className="sheet__label">Остальная недвижимость</p> : null}
          <SwitchRows label="Недвижимость" objects={rest} />
        </>
      ) : null}
    </Sheet>
  );
}
function ReadingsView({ card }: { card: ObjectCard }) {
  const { me, householdId } = useHousehold();
  const abilities = objectAbilities(viewerOf(me), card, householdId);
  const metersQuery = useMeters(card.id, 'all');
  const today = todayIn(me.timeZone);
  const [date, setDate] = useState<string>(today);
  const [drafts, setDrafts] = useState<Record<string, ReadingDraft>>({});
  const [files, setFilesState] = useState<Record<string, File[]>>({});
  const [uploaded, setUploaded] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<SavedBatch | null>(null);
  const base = `/home/${card.id}/readings`;

  const allMeters = metersQuery.data ?? [];
  const meters = useMemo(
    () => allMeters.filter((item) => item.data.status === 'active'),
    [allMeters],
  );

  const value: ReadingsContext = {
    card,
    canWrite: abilities.edit && card.deletedAt === null,
    today,
    meters,
    allMeters,
    metersLoading: metersQuery.isPending,
    date,
    setDate,
    drafts,
    setDraft: (meterId, draft) => setDrafts((previous) => ({ ...previous, [meterId]: draft })),
    files,
    setFiles: (meterId, list) => setFilesState((previous) => ({ ...previous, [meterId]: list })),
    uploaded,
    setUploaded,
    saved,
    setSaved,
    prefill: (meterId, draft) => {
      setDrafts((previous) => ({ ...previous, [meterId]: draft }));
      setUploaded((previous) => ({ ...previous, [meterId]: [] }));
    },
  };

  const status = card.objectType === 'property' ? card.typeData.status : undefined;
  return (
    <Page
      title={card.title}
      documentTitle="Показания"
      eyebrow="Показания"
      back={{ to: `/home/${card.id}/meters`, label: 'Счётчики' }}
      {...(status ? { status: <PropertyStatusBadge status={status} /> } : {})}
      tabs={
        <LinkTabs
          label="Разделы показаний"
          items={[
            { to: base, label: 'Ввод', end: true },
            { to: `${base}/transfer`, label: 'Передача' },
          ]}
        />
      }
    >
      {card.objectType !== 'property' ? (
        <Notice>Счётчики и показания есть только у недвижимости.</Notice>
      ) : (
        <Context.Provider value={value}>
          <SwitchObject currentId={card.id} />
          <Outlet />
        </Context.Provider>
      )}
    </Page>
  );
}

/** Каркас экрана «Показания»: заголовок с названием объекта, вкладки «Ввод» и «Передача». */
export function ReadingsLayout() {
  const { objectId } = useParams();
  const query = useObjectCard(objectId);
  if (query.isPending) {
    return (
      <Page title="Показания" back={{ to: '/home', label: 'Дом' }}>
        <Notice>Загружаем объект…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Показания" back={{ to: '/home', label: 'Дом' }}>
        <ObjectError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку объекта
        </button>
      </Page>
    );
  }
  return <ReadingsView key={query.data.id} card={query.data} />;
}
