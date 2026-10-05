import { LockSimple, ShareNetwork, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { AccessCaption } from '../access/AccessBadge.tsx';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope, SCOPE_LABELS } from '../access/scope.ts';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { whoLosesAccess } from '../access/who-sees.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { HOUSE_MEMBERS, ME } from './data/index.ts';
import { usePrototype } from './store.tsx';

type Action = 'share' | 'audience' | 'private';

interface AccessActionsProps {
  id: string;
  visibility: Visibility;
  /** Как называть запись в сообщениях: «заметка», «документ». */
  what: string;
}

const SHARED_OPTIONS: readonly Visibility[] = ['adults', 'household'];

function names(members: readonly { name: string }[]): string {
  return members.map((member) => member.name).join(' и ');
}

/**
 * Подпись доступа и действия в карточке — PRD, 7.4: «Поделиться…» у личной записи,
 * «Кто видит» и «Сделать личной…» у общей. Сужение доступа требует подтверждения
 * и показывает, кто потеряет доступ (правило 7.3.8).
 */
export function AccessActions({ id, visibility, what }: AccessActionsProps) {
  const { dispatch } = usePrototype();
  const { scope, setScope } = useScope();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [choice, setChoice] = useState<Visibility>('adults');

  const losers =
    action === 'private'
      ? whoLosesAccess(visibility, 'personal', ME, HOUSE_MEMBERS)
      : action === 'audience'
        ? whoLosesAccess(visibility, choice, ME, HOUSE_MEMBERS)
        : [];

  function open(next: Action) {
    setChoice(next === 'share' ? 'adults' : visibility === 'adults' ? 'household' : 'adults');
    setAction(next);
  }

  function apply() {
    const next: Visibility = action === 'private' ? 'personal' : choice;
    dispatch({ type: 'setVisibility', id, visibility: next });
    const hidden = !matchesScope(next, scope);
    toast.show({
      message: `Теперь ${what}: ${VISIBILITY_LABELS[next]}`,
      ...(hidden
        ? { detail: `Сейчас включён режим «${SCOPE_LABELS[scope]}» — в списках записи не видно.` }
        : {}),
      ...(hidden ? { action: { label: 'Показать всё', onClick: () => setScope('all') } } : {}),
      durationMs: hidden ? 10_000 : 7000,
    });
    setAction(null);
  }

  return (
    <>
      <div className="access-card">
        <h2 className="access-card__title">Кто видит</h2>
        <AccessCaption visibility={visibility} />
        <div className="btn-row">
          {visibility === 'personal' ? (
            <button type="button" className="btn btn--secondary" onClick={() => open('share')}>
              <ShareNetwork size={20} aria-hidden />
              Поделиться…
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--secondary" onClick={() => open('audience')}>
                <UsersThree size={20} aria-hidden />
                Кто видит…
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => open('private')}>
                <LockSimple size={20} aria-hidden />
                Сделать личной…
              </button>
            </>
          )}
        </div>
      </div>

      <Sheet
        open={action !== null}
        onOpenChange={(next) => {
          if (!next) setAction(null);
        }}
        title={
          action === 'share' ? 'Поделиться' : action === 'private' ? 'Сделать личной' : 'Кто видит'
        }
        description={
          action === 'share'
            ? `Выберите, кому показать ${what}. Вместе с ней откроются связанные записи и файлы.`
            : action === 'private'
              ? `Видеть ${what} будете только вы.`
              : `Выберите, кто видит ${what} в общем пространстве дома.`
        }
      >
        {action === 'share' || action === 'audience' ? (
          <VisibilityPicker
            legend={action === 'share' ? 'Кому показать' : 'Кто видит'}
            value={choice}
            options={SHARED_OPTIONS}
            onChange={setChoice}
          />
        ) : null}
        {losers.length > 0 ? (
          <p className="warning-box" role="alert">
            Доступ потеряет: {names(losers)}. Они больше не увидят {what}.
          </p>
        ) : null}
        <button
          type="button"
          className={
            action === 'private'
              ? 'btn btn--danger btn--block sheet__next'
              : 'btn btn--primary btn--block sheet__next'
          }
          onClick={apply}
        >
          {action === 'share'
            ? 'Поделиться'
            : action === 'private'
              ? 'Сделать личной'
              : 'Сохранить'}
        </button>
      </Sheet>
    </>
  );
}
