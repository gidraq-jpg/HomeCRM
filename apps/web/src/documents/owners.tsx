import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { fetchObjects } from '../objects/api.ts';
import { useOrganizationOptions } from '../organizations/queries.ts';
import { usePeopleOptions } from '../people/queries.ts';
import { NO_OWNER, type OwnerFacts, ownerKey, parseOwnerKey } from './access.ts';

// Владелец документа (DOC-2): участник дома, контакт или объект. Список для выбора собирается из
// тех записей, которые видит сам участник; название владельца в адрес и хранилища не попадает.

const OWNER_OBJECTS = 'document-owner-objects';

export interface OwnerChoices {
  members: { id: string; name: string; child: boolean }[];
  objects: { id: string; title: string; visibility: ReturnType<typeof visibilityOf> }[];
  organizations: { id: string; title: string }[];
  /** Люди из контактов: у них есть дата рождения, по ней считается срок паспорта. */
  contacts: { id: string; title: string }[];
  /** Все три списка загружены; пока нет — выбор владельца ещё неполон. */
  ready: boolean;
}

export function useOwnerChoices(): OwnerChoices {
  const { me } = useHousehold();
  const members = useMembers();
  const objects = useQuery({
    queryKey: [OWNER_OBJECTS],
    queryFn: ({ signal }) => fetchObjects('all', { trash: false, offset: 0 }, signal),
  });
  const organizations = useOrganizationOptions();
  const contacts = usePeopleOptions();
  const people = (members.data ?? [])
    .filter((member) => !member.formerMember)
    .map((member) => ({
      id: member.accountId,
      name: member.accountId === me.id ? `Вы (${member.displayName})` : member.displayName,
      child: member.role === 'child',
    }));
  return {
    members: people.some((member) => member.id === me.id)
      ? people
      : [{ id: me.id, name: 'Вы', child: false }, ...people],
    objects: (objects.data ?? []).map((object) => ({
      id: object.id,
      title: object.title,
      visibility: visibilityOf(object),
    })),
    organizations: (organizations.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
    })),
    contacts: (contacts.data ?? []).map((item) => ({ id: item.id, title: item.title })),
    ready:
      !members.isPending && !objects.isPending && !organizations.isPending && !contacts.isPending,
  };
}

/** Что известно о выбранном владельце — для «Кто видит» по умолчанию. */
export function ownerFacts(choices: OwnerChoices, key: string): OwnerFacts {
  const owner = parseOwnerKey(key);
  if (owner === null) return NO_OWNER;
  if (owner.kind === 'member') {
    return {
      kind: 'member',
      childMember: choices.members.find((member) => member.id === owner.id)?.child ?? false,
      objectVisibility: null,
    };
  }
  if (owner.kind === 'object') {
    return {
      kind: 'object',
      childMember: false,
      objectVisibility:
        choices.objects.find((object) => object.id === owner.id)?.visibility ?? null,
    };
  }
  return { kind: 'contact', childMember: false, objectVisibility: null };
}

interface OwnerSelectProps {
  choices: OwnerChoices;
  value: string;
  onChange: (key: string) => void;
}

/** «Чей документ»: один список с группами; владелец после создания не меняется. */
export function OwnerSelect({ choices, value, onChange }: OwnerSelectProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Чей документ
      </label>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Не указан</option>
        <optgroup label="Участники дома">
          {choices.members.map((member) => (
            <option key={member.id} value={ownerKey({ kind: 'member', id: member.id })}>
              {member.name}
            </option>
          ))}
        </optgroup>
        {choices.objects.length > 0 ? (
          <optgroup label="Объекты">
            {choices.objects.map((object) => (
              <option key={object.id} value={ownerKey({ kind: 'object', id: object.id })}>
                {object.title}
              </option>
            ))}
          </optgroup>
        ) : null}
        {choices.contacts.length > 0 ? (
          <optgroup label="Люди из контактов">
            {choices.contacts.map((item) => (
              <option key={item.id} value={ownerKey({ kind: 'contact', id: item.id })}>
                {item.title}
              </option>
            ))}
          </optgroup>
        ) : null}
        {choices.organizations.length > 0 ? (
          <optgroup label="Организации">
            {choices.organizations.map((item) => (
              <option key={item.id} value={ownerKey({ kind: 'contact', id: item.id })}>
                {item.title}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <p className="field__hint">Владельца после сохранения изменить нельзя.</p>
    </div>
  );
}
