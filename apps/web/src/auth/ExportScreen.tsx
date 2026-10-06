import * as z from 'zod';
import { Page, Section } from '../ui/Page.tsx';
import { api } from './api.ts';
import { AuthForm, clearSecrets, formValues, PasswordField, useAction } from './components.tsx';

const Export = z.object({
  exportedAt: z.string(),
  profile: z.object({ displayName: z.string(), username: z.string().nullable() }).nullable(),
  notes: z.array(z.object({ id: z.string(), title: z.string() })),
});
export function ExportScreen() {
  const state = useAction();
  return (
    <Page title="Экспорт" back={{ to: '/more', label: 'Ещё' }}>
      <p>Чужое личное в экспорт дома не попадает.</p>
      <Section title="Скачать свои данные">
        <p className="auth-hint">
          Подтвердите пароль. Файл содержит ваш профиль и доступные заметки.
        </p>
        <AuthForm
          state={state}
          submit="Скачать JSON"
          onSubmit={(event) => {
            const { form, text } = formValues(event);
            const password = text('password');
            clearSecrets(form);
            void state.run(async () => {
              const data = await api('export', Export, { password });
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'homecrm-export.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              state.setDone('Файл с вашими данными скачан.');
            });
          }}
        >
          <PasswordField label="Подтвердите пароль" />
        </AuthForm>
      </Section>
    </Page>
  );
}
