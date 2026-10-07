import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { fetchNote } from '../notes/api.ts';
import { fetchObject } from '../objects/api.ts';
import { Page } from '../ui/Page.tsx';

type Target =
  | { kind: 'loading' }
  | { kind: 'found'; to: string }
  | { kind: 'missing' }
  | { kind: 'error' };

/** Запись уведомления может быть объектом или заметкой: push несёт только её идентификатор. */
async function locate(id: string, signal: AbortSignal): Promise<Target> {
  try {
    await fetchObject(id, signal);
    return { kind: 'found', to: `/home/${id}` };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  try {
    await fetchNote(id, signal);
    return { kind: 'found', to: `/more/notes/${id}` };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  return { kind: 'missing' };
}

/** Нажатие на уведомление: открыть карточку записи. Адрес остаётся коротким, без названий. */
export function OpenRecordScreen() {
  const { recordId = '' } = useParams();
  const [target, setTarget] = useState<Target>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setTarget({ kind: 'loading' });
    locate(recordId, controller.signal).then(setTarget, (error: unknown) => {
      if (!(error instanceof Error && error.name === 'AbortError')) setTarget({ kind: 'error' });
    });
    return () => controller.abort();
  }, [recordId]);

  if (target.kind === 'found') return <Navigate to={target.to} replace />;
  return (
    <Page title="Открываем запись">
      {target.kind === 'loading' ? <Notice>Открываем запись…</Notice> : null}
      {target.kind === 'error' ? (
        <Notice error>Не удалось открыть запись. Проверьте подключение и повторите.</Notice>
      ) : null}
      {target.kind === 'missing' ? (
        <Notice>Записи больше нет, или она стала вам недоступна.</Notice>
      ) : null}
      {target.kind === 'loading' ? null : (
        <Link className="btn btn--secondary btn--block" to="/more/radar">
          Открыть радар сроков
        </Link>
      )}
    </Page>
  );
}
