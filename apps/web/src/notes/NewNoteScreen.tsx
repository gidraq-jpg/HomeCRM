import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { defaultVisibility, type Visibility } from '../access/visibility.ts';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { creatableVisibilities, newPlacement, viewerOf } from './abilities.ts';
import { createNote, type NoteInput } from './api.ts';
import { EMPTY_DRAFT, NoteForm } from './NoteForm.tsx';
import { useRefreshNotes } from './queries.ts';
import { accessToast } from './toasts.ts';

/**
 * Создание заметки («+» → «Заметка»). Строка «Кто видит» стоит над «Сохранить»; значение по
 * умолчанию — таблица 7.2 PRD и режим переключателя (раздел 7.4).
 */
export function NewNoteScreen() {
  const { me, householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshNotes();
  const state = useAction();
  const options = creatableVisibilities(viewerOf(me), householdId);
  const wanted = defaultVisibility('note', scope);
  const [visibility, setVisibility] = useState<Visibility>(
    options.includes(wanted) ? wanted : 'personal',
  );

  function submit(values: NoteInput) {
    void state.run(async () => {
      const created = await createNote(values, newPlacement(visibility, householdId));
      await refresh();
      toast.show(accessToast('Заметка сохранена', visibility, scope, () => setScope('all')));
      navigate(`/more/notes/${created.id}`, { replace: true });
    });
  }

  return (
    <Page title="Новая заметка" back={{ to: '/more/notes', label: 'Заметки' }}>
      <NoteForm
        draft={EMPTY_DRAFT}
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        action="create"
        state={state}
        onSubmit={submit}
        onCancel={() => navigate('/more/notes')}
        visibility={{ value: visibility, options, onChange: setVisibility }}
        visibilityNote={
          options.length === 1 ? (
            <p className="muted">
              {householdId === null
                ? 'Вы не состоите в доме, поэтому заметка будет личной.'
                : 'Общие заметки создают взрослые. Здесь вам доступны только личные: их видите только вы.'}
            </p>
          ) : null
        }
      />
    </Page>
  );
}
