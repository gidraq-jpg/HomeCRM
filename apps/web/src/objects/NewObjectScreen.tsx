import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { defaultVisibility, type Visibility } from '../access/visibility.ts';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { newPlacement, viewerOf } from '../notes/abilities.ts';
import { accessToast } from '../notes/toasts.ts';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { creatableObjectVisibilities } from './abilities.ts';
import { createObject } from './api.ts';
import { EMPTY_DRAFT, ObjectForm, type ObjectValues } from './ObjectForm.tsx';
import { useRefreshObjects } from './queries.ts';

const BACK = { to: '/home', label: 'Дом' } as const;

/**
 * Создание объекта («+» → «Объект» и из «Дома»). Строка «Кто видит» стоит над «Сохранить»;
 * значение по умолчанию — таблица 7.2 PRD (недвижимость — «Взрослые») и режим переключателя.
 */
export function NewObjectScreen() {
  const { me, householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const state = useAction();
  const options = creatableObjectVisibilities(viewerOf(me), householdId);
  const wanted = defaultVisibility('property', scope);
  const [visibility, setVisibility] = useState<Visibility>(
    options.includes(wanted) ? wanted : 'personal',
  );

  function submit(values: ObjectValues) {
    void state.run(async () => {
      const created = await createObject(
        { title: values.title, objectType: values.objectType },
        newPlacement(visibility, householdId),
      );
      await refresh();
      toast.show(accessToast('Объект сохранён', visibility, scope, () => setScope('all')));
      navigate(`/home/${created.id}`, { replace: true });
    });
  }

  return (
    <Page title="Новый объект" back={BACK}>
      <ObjectForm
        draft={EMPTY_DRAFT}
        mode="create"
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        action="create"
        state={state}
        onSubmit={submit}
        onCancel={() => navigate('/home')}
        visibility={{ value: visibility, options, onChange: setVisibility }}
        visibilityNote={
          options.length === 1 ? (
            <p className="muted">
              {householdId === null
                ? 'Вы не состоите в доме, поэтому объект будет личным.'
                : 'Общие объекты создают взрослые. Здесь вам доступны только личные: их видите только вы.'}
            </p>
          ) : null
        }
      />
    </Page>
  );
}
