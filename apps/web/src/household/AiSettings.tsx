import { AiStatus } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { Section } from '../ui/Page.tsx';

export function AiSettings({ spaceId, isAdmin }: { spaceId: string; isAdmin: boolean }) {
  const id = useId();
  const action = useAction();
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const query = useQuery({
    queryKey: ['ai-status', spaceId],
    queryFn: () => apiRequest('GET', `ai/status?spaceId=${spaceId}`, AiStatus),
  });
  return (
    <Section title="Искусственный интеллект">
      <p className="muted">
        Речь распознаётся на компьютере семьи. Текст и фото для разбора отправляются внешней модели
        через Hermes. Паспорта и медицинские документы не отправляются. ИИ предлагает черновики —
        сохраняет человек.
      </p>
      {query.isPending ? (
        <p role="status">Проверяем ИИ…</p>
      ) : query.isError ? (
        <Notice>Состояние ИИ недоступно. Ручной ввод работает.</Notice>
      ) : (
        <>
          {isAdmin ? (
            <label className="choice" htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                role="switch"
                aria-checked={pendingValue ?? query.data.enabled}
                checked={pendingValue ?? query.data.enabled}
                disabled={action.pending}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  setPendingValue(enabled);
                  void action.run(async () => {
                    try {
                      await apiRequest('PATCH', 'ai/settings', z.object({ enabled: z.boolean() }), {
                        spaceId,
                        enabled,
                      });
                      await query.refetch();
                    } finally {
                      setPendingValue(null);
                    }
                  });
                }}
              />
              <span className="choice__body">
                <span className="choice__title">Включить ИИ для дома</span>
                <span className="choice__hint" aria-hidden>
                  {(pendingValue ?? query.data.enabled) ? 'Включено' : 'Выключено'}
                </span>
              </span>
            </label>
          ) : (
            <p>
              ИИ {query.data.enabled ? 'включён' : 'выключен'}. Менять настройку может
              администратор.
            </p>
          )}
          {isAdmin && (
            <section aria-label="Состояние системы ИИ">
              <p>
                Речь: {query.data.speech ? 'доступна' : 'недоступна'}. Разбор:{' '}
                {query.data.extraction ? 'доступен' : 'недоступен'}.
              </p>
              <p>Осталось запросов на сегодня: {query.data.remaining}.</p>
            </section>
          )}
        </>
      )}
      {Boolean(action.error) && (
        <Notice>Не удалось сохранить настройку ИИ. Повторите попытку.</Notice>
      )}
    </Section>
  );
}
