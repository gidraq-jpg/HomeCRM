import { useState } from 'react';
import type { Visibility } from '../access/visibility.ts';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf } from '../notes/abilities.ts';
import { creatableOrganizationVisibilities, organizationPlacement } from './abilities.ts';
import { type ContactCard, createOrganization } from './api.ts';
import { emptyOrganizationDraft } from './form.ts';
import { OrganizationForm } from './OrganizationForm.tsx';
import { useRefreshOrganizations } from './queries.ts';

/** Можно ли здесь создавать организации: общие заводят взрослые (PRD 6.2). */
export function useCanCreateOrganization(): boolean {
  const { me, householdId } = useHousehold();
  return (
    creatableOrganizationVisibilities(viewerOf(me), householdId, me.personalSpaceId).length > 0
  );
}

/**
 * Создание организации: форма с «Кто видит». По умолчанию — «Вся семья» (PRD 7.2: УК и аварийная
 * служба нужны всем). Используется и на своём экране, и в панели «Новая организация» из формы счёта.
 */
export function CreateOrganization({
  onCreated,
  onCancel,
}: {
  onCreated: (card: ContactCard) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshOrganizations();
  const state = useAction();
  const options = creatableOrganizationVisibilities(viewerOf(me), householdId, me.personalSpaceId);
  const [visibility, setVisibility] = useState<Visibility>(
    options.includes('household') ? 'household' : (options[0] ?? 'personal'),
  );

  if (options.length === 0) {
    return (
      <p className="muted">
        Организации добавляют взрослые участники дома. Вы можете открыть и использовать уже
        добавленные.
      </p>
    );
  }

  return (
    <OrganizationForm
      draft={emptyOrganizationDraft()}
      submitLabel="Сохранить"
      pendingLabel="Сохраняем…"
      state={state}
      onCancel={onCancel}
      onSubmit={(values) =>
        void state.run(async () => {
          const created = await createOrganization(
            values,
            organizationPlacement(visibility, householdId, me.personalSpaceId),
          );
          await refresh();
          await onCreated(created);
        })
      }
      visibility={{ value: visibility, options, onChange: setVisibility }}
    />
  );
}
