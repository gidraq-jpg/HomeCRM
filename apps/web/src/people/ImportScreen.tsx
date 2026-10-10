import { useId, useRef, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITIES, VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { ApiError } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf, visibilityOf } from '../notes/abilities.ts';
import {
  creatableOrganizationVisibilities,
  organizationPlacement,
} from '../organizations/abilities.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { countWord } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { fetchContact } from './api.ts';
import {
  applyImport,
  type ImportChoice,
  type ImportFile,
  type ImportPreview,
  previewImport,
} from './import-api.ts';
import { PEOPLE_BACK } from './PersonScreen.tsx';
import { useRefreshContacts } from './queries.ts';

function widerThan(target: Visibility | undefined, selected: Visibility): boolean {
  return target !== undefined && VISIBILITIES.indexOf(target) > VISIBILITIES.indexOf(selected);
}

const audienceLabel = (value: Visibility) => VISIBILITY_LABELS[value].toLocaleLowerCase('ru');

function importError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413)
      return 'Файл слишком большой: выберите vCard до 512 КиБ и 500 контактов.';
    if (error.code === 'INVALID_VCARD' || error.status === 400)
      return 'Не удалось прочитать vCard. Экспортируйте контакты заново в формате vCard 3.0 или 4.0.';
    if (error.code === 'IMPORT_FIELD_LIMIT')
      return 'При объединении превышен размер полей контакта. Выберите «Создать отдельно» или сократите контакт.';
    if (error.status === 409)
      return 'Контакты изменились. Обновите предпросмотр и проверьте совпадения перед импортом.';
    if (error.status === 403 || error.status === 404)
      return 'Доступ к контактам изменился. Обновите предпросмотр.';
  }
  return 'Не удалось выполнить импорт. Проверьте подключение и повторите: тот же запрос не создаст дубли.';
}

/** CONT-6: файл и предпросмотр хранятся только до ухода с экрана, запросы без кэша. */
export function ImportScreen() {
  const { me, householdId } = useHousehold();
  const options = creatableOrganizationVisibilities(viewerOf(me), householdId, me.personalSpaceId);
  const [visibility, setVisibility] = useState<Visibility>('personal');
  const [file, setFile] = useState<{ fileName: string; content: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [targets, setTargets] = useState<Record<string, Visibility>>({});
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const state = useAction();
  const refresh = useRefreshContacts();
  const keyOf = useOperationKey();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const placement = organizationPlacement(visibility, householdId, me.personalSpaceId);

  async function loadPreview(source = file) {
    if (!source) return;
    setPreview(null);
    setChoices({});
    setConfirmed({});
    setTargets({});
    const next = await previewImport({ ...source, placement });
    const ids = [...new Set(next.items.flatMap((item) => item.matches.map((match) => match.id)))];
    const contacts = await Promise.all(ids.map((contactId) => fetchContact(contactId)));
    const access = Object.fromEntries(
      contacts.map((contact) => [contact.id, visibilityOf(contact)]),
    );
    // Аудитория должна принадлежать той же редакции, которую подтвердит применение импорта.
    if (
      next.items.some((item) =>
        item.matches.some(
          (match) =>
            contacts.find((contact) => contact.id === match.id)?.updatedAt !== match.updatedAt,
        ),
      )
    )
      throw new ApiError(409, 'IMPORT_PREVIEW_STALE');
    setTargets(access);
    setChoices(
      Object.fromEntries(
        next.items
          .filter((item) => item.matches.some((match) => widerThan(access[match.id], visibility)))
          .map((item) => [item.index, 'create']),
      ),
    );
    setPreview(next);
  }

  async function selectFile(selected: File | undefined) {
    setFile(null);
    setPreview(null);
    setChoices({});
    setResult(null);
    setFileError(null);
    state.setError(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.vcf')) {
      setFileError('Выберите файл контактов с расширением .vcf.');
      return;
    }
    if (selected.size > 512 * 1024) {
      setFileError('Файл слишком большой: выберите vCard до 512 КиБ.');
      return;
    }
    await state.run(async () => {
      const source = { fileName: selected.name, content: await selected.text() };
      setFile(source);
      await loadPreview(source);
    });
  }

  function apply() {
    if (!file || !preview || unresolved || unconfirmed || state.disabled) return;
    const selections: ImportChoice[] = preview.items.map((item) => {
      const match = item.matches.find(
        (candidate) => candidate.id === choices[item.index] && candidate.canMerge,
      );
      return match
        ? { index: item.index, action: 'merge', contactId: match.id, updatedAt: match.updatedAt }
        : { index: item.index, action: 'create' };
    });
    const source: ImportFile = { ...file, placement };
    const key = keyOf({ source, previewHash: preview.previewHash, selections });
    void state.run(async () => {
      await applyImport(source, preview.previewHash, selections, key);
      const merged = selections.filter((item) => item.action === 'merge').length;
      setResult(
        `Добавлено ${countWord(selections.length - merged, ['контакт', 'контакта', 'контактов'])}, объединено ${merged}`,
      );
      setFile(null);
      setPreview(null);
      setChoices({});
      await refresh();
    });
  }

  const unresolved =
    preview?.items.some((item) => item.matches.length > 0 && !choices[item.index]) ?? false;
  const broaderMerges =
    preview?.items.flatMap((item) => {
      const match = item.matches.find(
        (candidate) => candidate.id === choices[item.index] && candidate.canMerge,
      );
      const audience = match ? targets[match.id] : undefined;
      return audience && widerThan(audience, visibility) ? [{ index: item.index, audience }] : [];
    }) ?? [];
  const unconfirmed = broaderMerges.some((item) => !confirmed[item.index]);
  return (
    <Page title="Импорт из файла" back={PEOPLE_BACK}>
      <p className="muted">
        Выберите vCard 3.0 или 4.0 (.vcf): до 512 КиБ, не больше 500 контактов. Фото пропускаются.
      </p>
      {result ? <Notice>{result}</Notice> : null}
      <fieldset disabled={state.disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Файл контактов
          </label>
          <input
            hidden
            ref={fileInput}
            id={id}
            type="file"
            accept=".vcf,text/vcard"
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => fileInput.current?.click()}
          >
            Выбрать файл
          </button>
          {file ? (
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>
              {file.fileName}
            </p>
          ) : null}
        </div>
        {preview ? (
          <Section title="Предпросмотр">
            <ul className="card-list" aria-label="Контакты из файла">
              {preview.items.map((item) => {
                const broaderMerge = broaderMerges.find((entry) => entry.index === item.index);
                return (
                  <li className="card" key={item.index}>
                    <h3 className="card__title">{item.title}</h3>
                    <p className="muted">
                      {item.matches.length === 0 ? 'Новый контакт' : 'Совпадение по телефону'}
                    </p>
                    <p className="muted">
                      {item.data.phones.map((phone) => phone.number).join(' · ')}
                    </p>
                    {item.matches.map((match) => {
                      const audience = targets[match.id];
                      return audience && widerThan(audience, visibility) ? (
                        <p className="muted" key={match.id}>
                          {match.title} · Видят: {audienceLabel(audience)}
                        </p>
                      ) : null;
                    })}
                    {item.matches.length > 0 ? (
                      <ChipGroup
                        legend={`Что сделать: ${item.title}`}
                        value={choices[item.index] ?? ''}
                        options={[
                          { value: 'create', label: 'Создать отдельно' },
                          ...item.matches
                            .filter((match) => match.canMerge)
                            .map((match) => ({
                              value: match.id,
                              label: `Объединить: ${match.title}`,
                            })),
                        ]}
                        onChange={(value) => {
                          setChoices((previous) => ({ ...previous, [item.index]: value }));
                          setConfirmed((previous) => ({ ...previous, [item.index]: false }));
                        }}
                      />
                    ) : null}
                    {broaderMerge ? (
                      <>
                        <p>
                          Добавленные телефоны, дата рождения и заметка станут видны:{' '}
                          {audienceLabel(broaderMerge.audience)}.
                        </p>
                        <CheckLine
                          checked={confirmed[item.index] ?? false}
                          onChange={(checked) =>
                            setConfirmed((previous) => ({ ...previous, [item.index]: checked }))
                          }
                        >
                          Подтверждаю доступ: {audienceLabel(broaderMerge.audience)}
                        </CheckLine>
                      </>
                    ) : null}
                    {item.matches.some((match) => !match.canMerge) ? (
                      <p className="muted">
                        Для части совпадений нет права объединения. Можно создать контакт отдельно.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
        <VisibilityPicker
          value={visibility}
          options={options}
          hint={
            broaderMerges.length > 0
              ? 'Выбранный доступ применяется к новым отдельным контактам. При объединении действует доступ контакта-цели, указанный в предпросмотре.'
              : undefined
          }
          onChange={(value) => {
            setVisibility(value);
            setPreview(null);
            setChoices({});
            setResult(null);
            state.setError(null);
          }}
        />
        {preview ? (
          <button
            className="btn btn--primary btn--block"
            type="button"
            disabled={unresolved || unconfirmed || preview.items.length === 0}
            onClick={apply}
          >
            Импортировать
          </button>
        ) : file ? (
          <button
            className="btn btn--primary btn--block"
            type="button"
            onClick={() => void state.run(() => loadPreview())}
          >
            Обновить предпросмотр
          </button>
        ) : null}
        {preview && file ? (
          <button
            className="text-button"
            type="button"
            onClick={() =>
              void state.run(async () => {
                await loadPreview();
                state.setError(null);
              })
            }
          >
            Обновить предпросмотр
          </button>
        ) : null}
      </fieldset>
      {state.pending ? <Notice>Обрабатываем файл…</Notice> : null}
      {fileError || state.error ? (
        <Notice error>{fileError ?? importError(state.error)}</Notice>
      ) : null}
    </Page>
  );
}
