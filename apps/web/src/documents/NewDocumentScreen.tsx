import type { DocumentType } from '@homecrm/shared';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { creatableVisibilities, viewerOf } from '../notes/abilities.ts';
import { accessToast } from '../notes/toasts.ts';
import { assigneeChoices } from '../objects/abilities.ts';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  defaultDocumentVisibility,
  documentVisibilityOptions,
  ownerKey,
  parseOwnerKey,
} from './access.ts';
import { createDocument } from './api.ts';
import { DocumentForm, type DocumentValues } from './DocumentForm.tsx';
import { EMPTY_DOCUMENT } from './form.ts';
import { OwnerSelect, ownerFacts, useOwnerChoices } from './owners.tsx';
import { useRefreshDocuments } from './queries.ts';

const BACK = { to: '/documents', label: 'Документы' } as const;

/**
 * Новый документ («+» → «Документ» и из раздела). «Кто видит» стоит над «Сохранить»; значение по
 * умолчанию — таблица 7.2 PRD: документ взрослого личный, ребёнка — «Взрослые», объекта — как у объекта.
 */
export function NewDocumentScreen() {
  const { me, householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshDocuments();
  const members = useMembers();
  const choices = useOwnerChoices();
  const state = useAction();
  const assigneeId = useId();

  const viewer = viewerOf(me);
  const creatable = creatableVisibilities(viewer, householdId, 'document');
  const [ownerChoice, setOwnerChoice] = useState(() => ownerKey({ kind: 'member', id: me.id }));
  const [type, setType] = useState<DocumentType>(EMPTY_DOCUMENT.type);
  const [chosen, setChosen] = useState<Visibility | null>(null);
  const [assignee, setAssignee] = useState<string>('');

  const facts = ownerFacts(choices, ownerChoice);
  const options = documentVisibilityOptions(creatable, facts, type);
  // Пока человек сам не выбрал, «Кто видит» следует за владельцем, типом и режимом в шапке.
  const visibility: Visibility =
    chosen !== null && options.includes(chosen)
      ? chosen
      : defaultDocumentVisibility(scope, facts, options);

  const candidates =
    visibility === 'personal' || householdId === null
      ? []
      : assigneeChoices(
          viewer,
          {
            spaceId: householdId,
            spaceKind: 'household',
            audience: visibility,
            authorId: me.id,
            assigneeId: me.id,
            deletedAt: null,
          },
          members.data ?? [],
        );

  function submit(values: DocumentValues) {
    void state.run(async () => {
      const placement =
        visibility === 'personal' || householdId === null
          ? me.personalSpaceId === null
            ? undefined
            : { spaceId: me.personalSpaceId }
          : { spaceId: householdId, audience: visibility };
      const created = await createDocument({
        title: values.title,
        data: values.data,
        owner: parseOwnerKey(ownerChoice),
        ...(placement ? { placement } : {}),
        ...(assignee !== '' && assignee !== me.id && candidates.some((c) => c.id === assignee)
          ? { assigneeId: assignee }
          : {}),
      });
      await refresh();
      toast.show(accessToast('Документ сохранён', visibility, scope, () => setScope('all')));
      navigate(`/documents/${created.id}`, { replace: true });
    });
  }

  return (
    <Page title="Новый документ" back={BACK}>
      <DocumentForm
        draft={EMPTY_DOCUMENT}
        mode="create"
        submitLabel="Сохранить"
        pendingLabel="Сохраняем…"
        action="create"
        state={state}
        onSubmit={submit}
        onCancel={() => navigate('/documents')}
        onTypeChange={setType}
        owner={<OwnerSelect choices={choices} value={ownerChoice} onChange={setOwnerChoice} />}
      >
        {candidates.length > 1 ? (
          <div className="field">
            <label className="field__label" htmlFor={assigneeId}>
              Ответственный за продление
            </label>
            <select
              id={assigneeId}
              className="select"
              value={assignee === '' ? me.id : assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id === me.id ? 'Вы' : candidate.name}
                </option>
              ))}
            </select>
            <p className="field__hint">Он получает напоминания, когда срок подходит.</p>
          </div>
        ) : null}
        <VisibilityPicker
          value={visibility}
          options={options}
          onChange={(next) => setChosen(next)}
        />
        {facts.kind === 'object' ? (
          <p className="muted">Документ объекта по умолчанию виден так же, как сам объект.</p>
        ) : facts.childMember ? (
          <p className="muted">
            Документы ребёнка по умолчанию видят взрослые дома. Удостоверение ребёнка нельзя открыть
            всей семье.
          </p>
        ) : null}
      </DocumentForm>
    </Page>
  );
}
