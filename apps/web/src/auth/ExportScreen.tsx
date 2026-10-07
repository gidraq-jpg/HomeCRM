import { ExportHistoryItem, type ExportScope } from '@homecrm/shared';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { ApiError, api } from './api.ts';
import {
  AuthForm,
  clearSecrets,
  ErrorNotice,
  formValues,
  Notice,
  PasswordField,
  useAction,
} from './components.tsx';

function DownloadForm({
  scope,
  label,
  onDownloaded,
}: {
  scope: ExportScope;
  label: string;
  onDownloaded: () => void;
}) {
  const state = useAction();
  const id = useId();
  return (
    <AuthForm
      state={state}
      submit={label}
      onSubmit={(event) => {
        const { form, text } = formValues(event);
        const password = text('password');
        clearSecrets(form);
        void state.run(async () => {
          let response: Response;
          try {
            response = await fetch('/api/export/archive', {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ scope, password, confirmed: true }),
            });
          } catch {
            throw new ApiError(0, 'NETWORK');
          }
          if (!response.ok) {
            const error = await response.json().catch(() => null);
            throw new ApiError(
              response.status,
              error?.code ?? '',
              Number(response.headers.get('retry-after')) || 0,
            );
          }
          if (!response.headers.get('content-type')?.startsWith('application/zip'))
            throw new ApiError(502, 'INVALID_RESPONSE');
          let blob: Blob;
          try {
            blob = await response.blob();
          } catch {
            throw new ApiError(0, 'NETWORK');
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `homecrm-${scope.kind}.zip`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          state.setDone('Архив передан браузеру для скачивания.');
          onDownloaded();
        });
      }}
    >
      <PasswordField label="Подтвердите пароль" />
      <label className="auth-checkbox" htmlFor={id}>
        <input id={id} type="checkbox" required />
        <span>Скачать архив с открытыми данными и файлами</span>
      </label>
      {state.pending && <Notice>Собираем и скачиваем архив… Дождитесь завершения.</Notice>}
    </AuthForm>
  );
}

export function ExportScreen() {
  const { me } = useHousehold();
  const houses = me.roles.filter(({ role }) => role === 'admin');
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<z.infer<typeof ExportHistoryItem>[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const refresh = () => setRevision((value) => value + 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision обновляет историю после выгрузки или явного повтора.
  useEffect(() => {
    let active = true;
    setHistoryError(null);
    void api('export/history', z.array(ExportHistoryItem))
      .then((events) => {
        if (active) setHistory(events);
      })
      .catch((error: unknown) => {
        if (active) setHistoryError(error);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <Page title="Мои данные" back={{ to: '/more', label: 'Ещё' }}>
      <p>
        ZIP-архив содержит JSON и файлы без шифрования, включая корзину. Храните его в безопасном
        месте.
      </p>
      <Section title="Моё личное">
        <p className="auth-hint">
          Ваши личные записи, профиль и настройки уведомлений. Чужое личное сюда не попадает.
        </p>
        <DownloadForm
          scope={{ kind: 'personal' }}
          label="Скачать моё личное"
          onDownloaded={refresh}
        />
      </Section>
      {houses.map(({ householdId }, index) => (
        <Section
          key={householdId}
          title={houses.length > 1 ? `Общее дома ${index + 1}` : 'Общее дома'}
        >
          <p className="auth-hint">
            Общие записи «Вся семья» и «Взрослые», файлы и состав дома. Личные записи участников
            сюда не попадают.
          </p>
          <DownloadForm
            scope={{ kind: 'household', householdId }}
            label="Скачать общее дома"
            onDownloaded={refresh}
          />
        </Section>
      ))}
      <p className="auth-hint">Если выгрузка не удалась, введите пароль и повторите скачивание.</p>
      <Section title="История выгрузок">
        <p className="auth-hint">
          Последние 50 подготовленных архивов. Сохранение файла на устройстве подтверждает браузер.
        </p>
        <ErrorNotice error={historyError} />
        {historyError ? (
          <button className="btn" type="button" onClick={refresh}>
            Повторить загрузку истории
          </button>
        ) : history === null ? (
          <p role="status">Загружаем историю…</p>
        ) : history.length === 0 ? (
          <p className="muted">Выгрузок пока нет.</p>
        ) : (
          <ul>
            {history.map((event) => (
              <li key={event.id}>
                {event.kind === 'personal' ? 'Моё личное' : 'Общее дома'} ·{' '}
                {event.account_id === me.id ? 'Вы' : (event.actor_name ?? 'Участник дома')} ·{' '}
                {new Intl.DateTimeFormat('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: me.timeZone,
                }).format(new Date(event.created_at))}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
