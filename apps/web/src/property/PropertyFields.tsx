import { PROPERTY_KINDS, PROPERTY_STATUSES } from '@homecrm/shared';
import { useId } from 'react';
import { useMembers } from '../household/queries.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import {
  CADASTRAL_HINT,
  MAX_ADDRESS,
  PROPERTY_KIND_LABELS,
  PROPERTY_STATUS_LABELS,
  type PropertyDraft,
  type PropertyErrors,
  type PropertyKind,
  type PropertyStatus,
  toggleOwner,
} from './property.ts';

interface PropertyFieldsProps {
  draft: PropertyDraft;
  errors: PropertyErrors;
  onChange: (change: Partial<PropertyDraft>) => void;
  /** Префикс для идентификаторов полей: по ним форма ставит фокус на первую ошибку. */
  idPrefix: string;
}

/**
 * Поля недвижимости в форме объекта (UTIL-1): вид, адрес, площадь, кадастровый номер, статус и
 * собственники-участники. Ошибки формата показываются у своего поля.
 */
export function PropertyFields({ draft, errors, onChange, idPrefix }: PropertyFieldsProps) {
  const members = useMembers();
  const ids = useId();
  const id = (name: string) => `${idPrefix}-${name}`;
  // Бывший участник виден в списке, только пока он отмечен собственником: чтобы его можно было снять.
  const owners = (members.data ?? []).filter(
    (member) => !member.formerMember || draft.ownerMemberIds.includes(member.accountId),
  );

  return (
    <fieldset className="field-edit property-fields">
      <legend className="field__label">Недвижимость</legend>

      <div className="field">
        <label className="field__label" htmlFor={id('kind')}>
          Вид
        </label>
        <select
          id={id('kind')}
          className="select"
          value={draft.kind}
          onChange={(event) => onChange({ kind: event.target.value as PropertyKind | '' })}
        >
          <option value="">Не указан</option>
          {PROPERTY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {PROPERTY_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('address')}>
          Адрес
        </label>
        <input
          id={id('address')}
          className="input"
          value={draft.address}
          maxLength={MAX_ADDRESS}
          autoComplete="off"
          aria-invalid={errors.address !== undefined}
          aria-describedby={errors.address === undefined ? undefined : `${id('address')}-error`}
          onChange={(event) => onChange({ address: event.target.value })}
        />
        {errors.address === undefined ? null : (
          <p className="field__error" id={`${id('address')}-error`} role="alert">
            {errors.address}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('area')}>
          Площадь, м²
        </label>
        <input
          id={id('area')}
          className="input"
          inputMode="decimal"
          value={draft.area}
          autoComplete="off"
          aria-invalid={errors.area !== undefined}
          aria-describedby={errors.area === undefined ? `${ids}-area-hint` : `${id('area')}-error`}
          onChange={(event) => onChange({ area: event.target.value })}
        />
        {errors.area === undefined ? (
          <p className="field__hint" id={`${ids}-area-hint`}>
            Например, 54,3. Запятая и точка подходят одинаково.
          </p>
        ) : (
          <p className="field__error" id={`${id('area')}-error`} role="alert">
            {errors.area}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('cadastral')}>
          Кадастровый номер
        </label>
        <input
          id={id('cadastral')}
          className="input"
          inputMode="text"
          value={draft.cadastralNumber}
          autoComplete="off"
          aria-invalid={errors.cadastralNumber !== undefined}
          aria-describedby={
            errors.cadastralNumber === undefined
              ? `${ids}-cadastral-hint`
              : `${id('cadastral')}-error`
          }
          onChange={(event) => onChange({ cadastralNumber: event.target.value })}
        />
        {errors.cadastralNumber === undefined ? (
          <p className="field__hint" id={`${ids}-cadastral-hint`}>
            {CADASTRAL_HINT}
          </p>
        ) : (
          <p className="field__error" id={`${id('cadastral')}-error`} role="alert">
            {errors.cadastralNumber}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={id('status')}>
          Статус
        </label>
        <select
          id={id('status')}
          className="select"
          value={draft.status}
          onChange={(event) => onChange({ status: event.target.value as PropertyStatus | '' })}
        >
          <option value="">Не указан</option>
          {PROPERTY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROPERTY_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {owners.length > 0 ? (
        <fieldset className="field-edit property-fields__owners">
          <legend className="field__label">Собственники</legend>
          {owners.map((member) => (
            <CheckLine
              key={member.accountId}
              checked={draft.ownerMemberIds.includes(member.accountId)}
              onChange={(on) =>
                onChange({
                  ownerMemberIds: toggleOwner(draft.ownerMemberIds, member.accountId, on),
                })
              }
            >
              {member.formerMember ? `${member.displayName} (бывший участник)` : member.displayName}
            </CheckLine>
          ))}
          <p className="field__hint">
            Участники дома. Собственников-контактов связывают в блоке «Люди и организации».
          </p>
        </fieldset>
      ) : null}
    </fieldset>
  );
}
