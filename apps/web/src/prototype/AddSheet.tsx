import {
  AddressBook,
  Buildings,
  CaretLeft,
  CheckCircle,
  FileText,
  Note,
  ShoppingCart,
} from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope, SCOPE_LABELS } from '../access/scope.ts';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import {
  defaultVisibility,
  type NewRecordKind,
  VISIBILITY_LABELS,
  type Visibility,
} from '../access/visibility.ts';
import { addDays, type DateOnly } from '../ui/format.ts';
import { Row, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { AddController } from './add-request.tsx';
import { ME, TODAY } from './data/index.ts';
import type { DocGroup, ProtoRecord } from './model.ts';
import { useAllRecords, usePrototype } from './store.tsx';

interface KindInfo {
  kind: NewRecordKind;
  label: string;
  hint: string;
  title: string;
  saved: string;
  titleLabel: string;
  icon: ReactNode;
}

const KINDS: readonly KindInfo[] = [
  {
    kind: 'task',
    label: 'Дело',
    hint: 'Что нужно сделать',
    title: 'Новое дело',
    saved: 'Дело добавлено',
    titleLabel: 'Что нужно сделать',
    icon: <CheckCircle size={22} aria-hidden />,
  },
  {
    kind: 'note',
    label: 'Заметка',
    hint: 'Мысли, списки, записи',
    title: 'Новая заметка',
    saved: 'Заметка сохранена',
    titleLabel: 'Заголовок',
    icon: <Note size={22} aria-hidden />,
  },
  {
    kind: 'shopping',
    label: 'Покупка',
    hint: 'В список покупок',
    title: 'Новая покупка',
    saved: 'Покупка добавлена',
    titleLabel: 'Что купить',
    icon: <ShoppingCart size={22} aria-hidden />,
  },
  {
    kind: 'document',
    label: 'Документ',
    hint: 'Паспорт, полис, договор',
    title: 'Новый документ',
    saved: 'Документ добавлен',
    titleLabel: 'Название документа',
    icon: <FileText size={22} aria-hidden />,
  },
  {
    kind: 'contact',
    label: 'Контакт',
    hint: 'Человек или организация',
    title: 'Новый контакт',
    saved: 'Контакт добавлен',
    titleLabel: 'Имя или название',
    icon: <AddressBook size={22} aria-hidden />,
  },
  {
    kind: 'property',
    label: 'Объект',
    hint: 'Квартира, дом или дача',
    title: 'Новый объект',
    saved: 'Объект добавлен',
    titleLabel: 'Название объекта',
    icon: <Buildings size={22} aria-hidden />,
  },
];

/** Какой вид записи предложить первым на этом экране. */
function preferredKind(pathname: string): NewRecordKind {
  if (pathname.startsWith('/home')) return 'property';
  if (pathname.startsWith('/documents')) return 'document';
  if (pathname.startsWith('/people')) return 'contact';
  if (pathname.startsWith('/more/notes')) return 'note';
  if (pathname.startsWith('/more/shopping')) return 'shopping';
  return 'task';
}

const DOC_TYPES: readonly { value: string; group: DocGroup }[] = [
  { value: 'Паспорт', group: 'identity' },
  { value: 'Полис', group: 'policy' },
  { value: 'Договор', group: 'property' },
  { value: 'Гарантия и чек', group: 'other' },
  { value: 'Другое', group: 'other' },
];

const CONTACT_CATEGORIES: readonly { value: string; organization: boolean; shared: boolean }[] = [
  { value: 'Мастер', organization: false, shared: true },
  { value: 'Организация', organization: true, shared: true },
  { value: 'Друг или коллега', organization: false, shared: false },
  { value: 'Врач', organization: false, shared: false },
  { value: 'Другое', organization: false, shared: false },
];

const PROPERTY_TYPES = ['Квартира', 'Дом', 'Дача', 'Гараж'] as const;
const TEMPLATES = [
  'Без шаблона',
  'Квартира в многоквартирном доме',
  'Сдаваемая квартира',
  'Частный дом или дача',
] as const;

type When = 'today' | 'tomorrow' | 'none';

interface Fields {
  title: string;
  text: string;
  when: When;
  docType: string;
  expires: string;
  category: string;
  phone: string;
  address: string;
  propertyType: string;
  template: string;
}

const EMPTY_FIELDS: Fields = {
  title: '',
  text: '',
  when: 'today',
  docType: 'Полис',
  expires: '',
  category: 'Мастер',
  phone: '',
  address: '',
  propertyType: 'Квартира',
  template: 'Без шаблона',
};

function isDateOnly(value: string): value is DateOnly {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Кнопка «+»: что добавить, затем форма. В каждой форме над «Сохранить» стоит строка «Кто видит»;
 * её значение по умолчанию зависит от вида записи и от режима «Всё · Общее · Личное» (PRD, 7.4).
 */
export function AddSheet({ controller }: { controller: AddController }) {
  const { open, requestedKind, onOpenChange } = controller;
  const { pathname } = useLocation();
  const { scope, setScope } = useScope();
  const { state, dispatch } = usePrototype();
  const toast = useToast();
  const properties = useAllRecords('property');
  const titleRef = useRef<HTMLInputElement | null>(null);

  // undefined — вид не выбирали: идём за запросом пустого раздела («Добавить объект»), иначе —
  // список видов. null — пользователь вернулся к списку.
  const [picked, setPicked] = useState<NewRecordKind | null | undefined>(undefined);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [chosen, setChosen] = useState<Visibility | null>(null);
  const [error, setError] = useState('');
  const kind = picked === undefined ? requestedKind : picked;

  // Каждое открытие начинается с чистого листа: всё сбрасывается при закрытии.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPicked(undefined);
      setFields(EMPTY_FIELDS);
      setChosen(null);
      setError('');
    }
    onOpenChange(next);
  }

  const inProperty =
    matchPath('/home/:propertyId/*', pathname) ?? matchPath('/home/:propertyId', pathname);
  const parent = properties.find((property) => property.id === inProperty?.params.propertyId);
  const info = KINDS.find((item) => item.kind === kind);

  const category = CONTACT_CATEGORIES.find((item) => item.value === fields.category);
  const visibility: Visibility = kind
    ? (chosen ??
      defaultVisibility(kind, scope, {
        ...(parent && kind !== 'contact' ? { parent: parent.visibility } : {}),
        ...(category?.shared ? { sharedByNature: true } : {}),
      }))
    : 'personal';

  const ordered = [
    ...KINDS.filter((item) => item.kind === preferredKind(pathname)),
    ...KINDS.filter((item) => item.kind !== preferredKind(pathname)),
  ];

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    if (key === 'title') setError('');
  }

  function build(): ProtoRecord | null {
    if (kind === null) return null;
    const title = fields.title.trim();
    const id = `${kind}-new-${Date.now().toString(36)}-${state.added.length}`;
    const link =
      parent && kind !== 'contact' && kind !== 'property' ? { propertyId: parent.id } : {};
    switch (kind) {
      case 'task':
        return {
          id,
          kind,
          visibility,
          title,
          when:
            fields.when === 'today' ? TODAY : fields.when === 'tomorrow' ? addDays(TODAY, 1) : null,
          status: 'open',
          assignee: ME,
          ...link,
        };
      case 'note':
        return { id, kind, visibility, title, text: fields.text.trim(), created: TODAY, ...link };
      case 'shopping':
        return { id, kind, visibility, title, bought: false };
      case 'document': {
        const type = DOC_TYPES.find((item) => item.value === fields.docType);
        return {
          id,
          kind,
          visibility,
          title,
          docType: fields.docType,
          group: type?.group ?? 'other',
          owner: parent?.title ?? 'Анна',
          expires: isDateOnly(fields.expires) ? fields.expires : null,
          files: 0,
          ...link,
        };
      }
      case 'contact':
        return {
          id,
          kind,
          visibility,
          name: title,
          contactKind: category?.organization ? 'organization' : 'person',
          role: fields.category,
          phones: fields.phone.trim() ? [{ label: 'Телефон', number: fields.phone.trim() }] : [],
          propertyIds: parent ? [parent.id] : [],
          interactions: [],
        };
      case 'property':
        return {
          id,
          kind,
          visibility,
          title,
          address: fields.address.trim() || 'Адрес не указан',
          propertyType: fields.propertyType,
          status: 'live',
          responsible: ME,
          owners: 'Анна Орлова',
        };
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (fields.title.trim() === '') {
      setError('Напишите название — это единственное обязательное поле.');
      titleRef.current?.focus();
      return;
    }
    const record = build();
    if (record === null || info === undefined) return;
    dispatch({ type: 'add', record });
    handleOpenChange(false);

    const hidden = !matchesScope(record.visibility, scope);
    toast.show({
      message: info.saved,
      detail: hidden
        ? `Кто видит: ${VISIBILITY_LABELS[record.visibility]}. Режим «${SCOPE_LABELS[scope]}» её не показывает.`
        : `Кто видит: ${VISIBILITY_LABELS[record.visibility]}`,
      ...(hidden ? { action: { label: 'Показать всё', onClick: () => setScope('all') } } : {}),
      durationMs: hidden ? 10_000 : 7000,
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title={info ? info.title : 'Что добавить?'}
      description={
        info
          ? 'Обязательно только название — остальное можно заполнить позже.'
          : 'Выберите, что добавить. Дальше — название и «Кто видит».'
      }
    >
      {info === undefined ? (
        <RowList label="Что добавить">
          {ordered.map((item) => (
            <Row
              key={item.kind}
              icon={item.icon}
              title={item.label}
              meta={item.hint}
              onClick={() => setPicked(item.kind)}
            />
          ))}
        </RowList>
      ) : (
        <form onSubmit={submit} noValidate>
          <button type="button" className="text-button" onClick={() => setPicked(null)}>
            <CaretLeft size={18} aria-hidden />
            Что добавить
          </button>

          {parent && kind !== 'contact' && kind !== 'property' ? (
            <p className="muted">
              Запись создаётся в карточке «{parent.title}»: по умолчанию доступ — как у объекта.
            </p>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="add-title">
              {info.titleLabel}
            </label>
            <input
              id="add-title"
              ref={titleRef}
              className="input"
              type="text"
              autoComplete="off"
              maxLength={160}
              value={fields.title}
              aria-invalid={error !== ''}
              aria-describedby={error ? 'add-title-error' : undefined}
              aria-required="true"
              onChange={(event) => set('title', event.target.value)}
            />
            {error ? (
              <p className="field__error" id="add-title-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {kind === 'task' ? (
            <div className="field">
              <label className="field__label" htmlFor="add-when">
                Когда
              </label>
              <select
                id="add-when"
                className="select"
                value={fields.when}
                onChange={(event) => set('when', event.target.value as When)}
              >
                <option value="today">Сегодня</option>
                <option value="tomorrow">Завтра</option>
                <option value="none">Без даты</option>
              </select>
            </div>
          ) : null}

          {kind === 'note' ? (
            <div className="field">
              <label className="field__label" htmlFor="add-text">
                Текст
              </label>
              <textarea
                id="add-text"
                className="textarea"
                value={fields.text}
                onChange={(event) => set('text', event.target.value)}
              />
            </div>
          ) : null}

          {kind === 'document' ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="add-doc-type">
                  Тип
                </label>
                <select
                  id="add-doc-type"
                  className="select"
                  value={fields.docType}
                  onChange={(event) => set('docType', event.target.value)}
                >
                  {DOC_TYPES.map((type) => (
                    <option key={type.value}>{type.value}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="add-expires">
                  Срок действия
                </label>
                <input
                  id="add-expires"
                  className="input"
                  type="date"
                  value={fields.expires}
                  onChange={(event) => set('expires', event.target.value)}
                />
                <p className="field__hint">Если срока нет, оставьте поле пустым.</p>
              </div>
            </>
          ) : null}

          {kind === 'contact' ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="add-category">
                  Кто это
                </label>
                <select
                  id="add-category"
                  className="select"
                  value={fields.category}
                  onChange={(event) => set('category', event.target.value)}
                >
                  {CONTACT_CATEGORIES.map((item) => (
                    <option key={item.value}>{item.value}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="add-phone">
                  Телефон
                </label>
                <input
                  id="add-phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={fields.phone}
                  onChange={(event) => set('phone', event.target.value)}
                />
              </div>
            </>
          ) : null}

          {kind === 'property' ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="add-property-type">
                  Тип
                </label>
                <select
                  id="add-property-type"
                  className="select"
                  value={fields.propertyType}
                  onChange={(event) => set('propertyType', event.target.value)}
                >
                  {PROPERTY_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="add-address">
                  Адрес
                </label>
                <input
                  id="add-address"
                  className="input"
                  type="text"
                  autoComplete="off"
                  value={fields.address}
                  onChange={(event) => set('address', event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="add-template">
                  Шаблон
                </label>
                <select
                  id="add-template"
                  className="select"
                  value={fields.template}
                  onChange={(event) => set('template', event.target.value)}
                >
                  {TEMPLATES.map((template) => (
                    <option key={template}>{template}</option>
                  ))}
                </select>
                <p className="field__hint">
                  Шаблон предлагает лицевые счета, счётчики и сроки; лишнее можно снять.
                </p>
              </div>
            </>
          ) : null}

          <VisibilityPicker value={visibility} onChange={setChosen} />

          <button type="submit" className="btn btn--primary btn--block sheet__next">
            Сохранить
          </button>
        </form>
      )}
    </Sheet>
  );
}
