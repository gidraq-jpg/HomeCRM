import { INBOX_MAX_BYTES, InboxCapture } from '@homecrm/shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { fileUrl } from '../files/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { localMessage, offlineEvents } from '../offline/identity.ts';
import { useQueue } from '../offline/OfflinePanel.tsx';
import { enqueue, synchronize } from '../offline/queue.ts';
import { offlineDB, uuid } from '../offline/store.ts';
import { Link } from '../shell/motion.tsx';
import { countWord } from '../ui/format.ts';
import { RollingNumber } from '../ui/RollingNumber.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
import { DictationButton, DictationStatus, useDictation } from '../voice/Dictation.tsx';
import { inboxAction, KIND_LABELS, STATUS_LABELS, useInbox } from './api.ts';
import './inbox.css';

export function InboxLink() {
  const data = useInbox();
  const { rows } = useQueue();
  const pending = rows.filter(
    (row) =>
      row.operation === 'inbox_create' &&
      row.state !== 'confirmed' &&
      !data.data?.some((entry) => entry.id === row.body.id),
  ).length;
  return (
    <div className="btn-row">
      <Link className="btn btn--secondary" to="/more/inbox/new">
        Записать во входящие
      </Link>
      <Link className="btn btn--secondary" to="/more/inbox">
        Входящие
        {data.data || pending ? (
          <>
            {' '}
            · <RollingNumber value={(data.data?.length ?? 0) + pending} />
          </>
        ) : null}
      </Link>
    </div>
  );
}
export function InboxScreen({
  capture = false,
  trash = false,
}: {
  capture?: boolean;
  trash?: boolean;
}) {
  const { me, householdId } = useHousehold();
  const location = useLocation();
  const attachmentMessage = (location.state as { attachmentMessage?: string } | null)
    ?.attachmentMessage;
  const query = useInbox(trash, true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [voice, setVoice] = useState(false);
  const [message, setMessage] = useState('');
  const [queued, setQueued] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [problem, setProblem] = useState('');
  const state = useAction();
  const status = useAiStatus(householdId);
  const checkingAi = !!householdId && status.isPending;
  const consent = useAiConsent(householdId, status.data?.provider);
  const dictation = useDictation((value) => {
    setText((old) => `${old}${old ? ' ' : ''}${value}`);
    setVoice(true);
    return undefined;
  });
  useEffect(() => {
    const refresh = () => {
      void offlineDB.outbox
        .where('owner')
        .equals(me.id)
        .filter((row) => row.operation === 'inbox_create' && row.state !== 'confirmed')
        .count()
        .then(setQueued);
    };
    refresh();
    offlineEvents.addEventListener('queue', refresh);
    return () => offlineEvents.removeEventListener('queue', refresh);
  }, [me.id]);
  async function save() {
    await state.run(async () => {
      setProblem('');
      if (files.reduce((s, f) => s + f.size, new Blob([text]).size) > INBOX_MAX_BYTES) {
        setProblem('На один элемент — не больше 10 МБ.');
        return;
      }
      const pages = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ name: string; base64: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error('FILE_READ'));
              reader.onload = () =>
                resolve({ name: file.name, base64: String(reader.result).split(',')[1] ?? '' });
              reader.readAsDataURL(file);
            }),
        ),
      );
      const id = uuid();
      const body = InboxCapture.parse({
        id,
        source: files.length
          ? files.every((f) => f.type.startsWith('image/'))
            ? 'photo'
            : 'file'
          : voice
            ? 'voice'
            : 'text',
        text,
        files: pages,
        houseId: householdId,
        consent: status.data?.enabled ? `v4:${status.data.provider}` : null,
      });
      try {
        await enqueue('POST', 'inbox', { ...body, idempotencyKey: id });
      } catch (error) {
        setProblem(
          localMessage(error) ?? 'Не удалось сохранить на устройстве. Введённое осталось в форме.',
        );
        return;
      }
      setText('');
      setFiles([]);
      setVoice(false);
      setInputKey((key) => key + 1);
      setMessage('Сохранено на устройстве. Отправится при появлении сети.');
      void synchronize().then(() => query.refetch());
    });
  }
  return (
    <StudioPage
      service
      title={trash ? 'Корзина входящих' : 'Входящие'}
      back={{ to: '/more', label: 'Ещё' }}
    >
      {attachmentMessage ? <Notice>{attachmentMessage}</Notice> : null}
      <p className="muted">Видите только вы. Через 30 дней неразобранное попадёт в корзину.</p>
      {capture ? (
        <form
          className="inbox-capture"
          aria-busy={checkingAi}
          onSubmit={(event) => {
            event.preventDefault();
            if (checkingAi) return;
            if (status.data?.enabled) consent.ask(() => void save());
            else void save();
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="inbox-text">
              Текст или диктовка
            </label>
            <textarea
              id="inbox-text"
              className="input"
              maxLength={20000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
            />
          </div>
          <DictationButton dictation={dictation} disabled={state.pending} />
          <DictationStatus dictation={dictation} />
          <div className="field">
            <label className="field__label" htmlFor="inbox-camera">
              Камера
            </label>
            <input
              key={`camera-${inputKey}`}
              id="inbox-camera"
              className="input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFiles((old) => [...old, ...Array.from(e.target.files ?? [])])}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="inbox-files">
              Галерея или файл — можно несколько страниц
            </label>
            <input
              key={inputKey}
              id="inbox-files"
              className="input"
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => setFiles((old) => [...old, ...Array.from(e.target.files ?? [])])}
            />
          </div>
          {files.length ? (
            <p>
              {countWord(files.length, ['файл', 'файла', 'файлов'])} ·{' '}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setFiles([]);
                  setInputKey((n) => n + 1);
                }}
              >
                Убрать файлы
              </button>
            </p>
          ) : null}
          <p className="field__hint">
            До 10 МБ вместе с текстом. Без ИИ останется для ручного разбора.
          </p>
          {problem ? <p role="alert">{problem}</p> : null}
          {state.error ? (
            <Notice error>Не удалось сохранить. Введённое осталось в форме.</Notice>
          ) : null}
          <button
            className="btn btn--primary"
            type="submit"
            disabled={checkingAi || state.pending || (!text.trim() && !files.length)}
          >
            {state.pending ? 'Сохраняем…' : 'Во входящие'}
          </button>
        </form>
      ) : (
        <Link className="btn btn--primary" to="/more/inbox/new">
          Во входящие
        </Link>
      )}
      {consent.dialog}
      {message ? <p role="status">{message}</p> : null}
      {queued ? (
        <p>
          <Link className="text-button" to="/more/offline">
            Ждут отправки: {queued}
          </Link>
        </p>
      ) : null}
      {query.isError ? (
        <Notice>
          Не удалось загрузить список. Сохранённое без сети доступно в очереди изменений.
        </Notice>
      ) : null}
      {query.data?.length === 0 ? (
        <p className="inbox-empty">
          Здесь пока пусто. Сохраните мысль, фото или документ и разберите, когда удобно.
        </p>
      ) : null}
      <ul className="inbox-list">
        {query.data?.map((row) => (
          <li key={row.id}>
            <p className="inbox-status">{STATUS_LABELS[row.status]}</p>
            {row.status !== 'identity' ? (
              <p className="inbox-text">{row.text || row.files[0]?.name || 'Входящее'}</p>
            ) : null}
            {row.draft ? <p>{KIND_LABELS[row.draft.classification.kind]}</p> : null}
            <div className="btn-row">
              {trash ? (
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() =>
                    void state.run(async () => {
                      await inboxAction(row.id, 'restore');
                      await query.refetch();
                    })
                  }
                >
                  Восстановить
                </button>
              ) : (
                <Link className="btn btn--secondary" to={`/more/inbox/${row.id}`}>
                  {row.status === 'identity' ? 'Заполнить вручную' : 'Открыть'}
                </Link>
              )}
              {row.files.map((file, i) => (
                <a className="text-button" key={file.id} href={fileUrl(file.id)}>
                  Страница {i + 1}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Link className="text-button" to={trash ? '/more/inbox' : '/more/inbox/trash'}>
        {trash ? 'Назад во входящие' : 'Корзина входящих'}
      </Link>
    </StudioPage>
  );
}
