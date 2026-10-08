import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { defaultObjectVisibility, type Visibility } from '../access/visibility.ts';
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

/** Нужное значение, если его можно создать; иначе личное. */
function fitVisibility(wanted: Visibility, options: readonly Visibility[]): Visibility {
  return options.includes(wanted) ? wanted : 'personal';
}

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
  const [visibility, setVisibility] = useState<Visibility>(() =>
    fitVisibility(defaultObjectVisibility('other', scope), options),
  );
  // Пока человек сам не выбрал, «Кто видит» следует за типом объекта (таблица 7.2).
  const [chosen, setChosen] = useState(false);

  function submit(values: ObjectValues) {
    void state.run(async () => {
      const created = await createObject(
        {
          title: values.title,
          objectType: values.objectType,
          ...(values.typeData ? { typeData: values.typeData } : {}),
        },
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
        onObjectTypeChange={(type) => {
          if (!chosen) setVisibility(fitVisibility(defaultObjectVisibility(type, scope), options));
        }}
        visibility={{
          value: visibility,
          options,
          onChange: (next) => {
            setChosen(true);
            setVisibility(next);
          },
        }}
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
