import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS, SCOPES } from '../access/scope.ts';

/** Переключатель «Всё · Общее · Личное» из шапки: фильтрует все разделы (SPACE-5). */
export function ScopeSwitch() {
  const { scope, setScope } = useScope();
  return (
    <fieldset className="scope-switch">
      <legend className="visually-hidden">Какие записи показывать</legend>
      {SCOPES.map((value) => (
        <label className="scope-switch__option" key={value}>
          <input
            type="radio"
            name="scope"
            value={value}
            checked={scope === value}
            onChange={() => setScope(value)}
          />
          <span className="scope-switch__label">{SCOPE_LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
