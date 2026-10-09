import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf } from '../notes/abilities.ts';
import { accessToast } from '../notes/toasts.ts';
import {
  creatableOrganizationVisibilities,
  organizationPlacement,
} from '../organizations/abilities.ts';
import { useOrganizationOptions } from '../organizations/queries.ts';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { createPerson } from './api.ts';
import { emptyPersonDraft } from './form.ts';
import { PersonForm } from './PersonForm.tsx';
import { PEOPLE_BACK } from './PersonScreen.tsx';
import { useRefreshContacts } from './queries.ts';

/**
 * Новый человек («Люди → Добавить человека»). «Кто видит» стоит над «Сохранить»: личный контакт
 * по умолчанию «Только я», мастер — «Вся семья» (PRD 7.2).
 */
export function NewPersonScreen() {
  const { me, householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const organizations = useOrganizationOptions();
  const state = useAction();
  const options = creatableOrganizationVisibilities(viewerOf(me), householdId, me.personalSpaceId);
  const [craftsperson, setCraftsperson] = useState(false);
  const [chosen, setChosen] = useState<Visibility | null>(null);
  const fallback: Visibility =
    craftsperson && options.includes('household') ? 'household' : 'personal';
  // Пока человек сам не выбрал, «Кто видит» следует за категорией «Мастер».
  const visibility: Visibility =
    chosen !== null && options.includes(chosen)
      ? chosen
      : options.includes(fallback)
        ? fallback
        : (options[0] ?? 'personal');

  return (
    <Page title="Новый человек" back={PEOPLE_BACK}>
      <PersonForm
        draft={emptyPersonDraft()}
        organizations={(organizations.data ?? []).map(({ id, title }) => ({ id, title }))}
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        state={state}
        onCancel={() => navigate('/people')}
        onCategoriesChange={(categories) => setCraftsperson(categories.includes('craftsperson'))}
        onSubmit={(values) =>
          void state.run(async () => {
            const created = await createPerson(
              values,
              organizationPlacement(visibility, householdId, me.personalSpaceId),
            );
            await refresh();
            toast.show(accessToast('Контакт сохранён', visibility, scope, () => setScope('all')));
            navigate(`/people/contacts/${created.id}`, { replace: true });
          })
        }
      >
        <VisibilityPicker value={visibility} options={options} onChange={setChosen} />
      </PersonForm>
    </Page>
  );
}
