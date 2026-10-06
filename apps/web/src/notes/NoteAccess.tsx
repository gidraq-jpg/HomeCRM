import { Copy, LockSimple, ShareNetwork, UsersThree } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AccessCaption } from '../access/AccessBadge.tsx';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { NoteAbilities } from './abilities.ts';
import { visibilityOf } from './abilities.ts';
import {
  changeAudience,
  copyToPersonal,
  makePersonal,
  type NoteCard,
  previewAccess,
  shareNote,
} from './api.ts';
import { NoteError } from './components.tsx';
import { useMakePersonalProbe, useRefreshNotes } from './queries.ts';
import { accessToast } from './toasts.ts';

type SheetName = 'share' | 'audience' | 'personal';

const SHARE_OPTIONS: readonly Visibility[] = ['adults', 'household'];

function names(people: readonly { displayName: string }[]): string {
  return people.map((person) => person.displayName).join(', ');
}

/** Кто потеряет доступ: имена из предпросмотра сервера, не из памяти страницы. */
function LosesAccess({
  people,
  empty,
}: {
  people: readonly { displayName: string }[];
  empty: string;
}) {
  if (people.length === 0) return <p className="muted sheet__block">{empty}</p>;
  return (
    <div className="warning-box" role="alert">
      <p>Доступ потеряют: {names(people)}.</p>
      <p>Заметка исчезнет у них из списков и поиска.</p>
    </div>
  );
}

function ShareSheet({ card, onClose }: { card: NoteCard; onClose: () => void }) {
  const { householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const refresh = useRefreshNotes();
  const toast = useToast();
  const state = useAction();
  const [choice, setChoice] = useState<Visibility>('adults');

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Поделиться заметкой"
      description="Выберите, кому показать заметку. Она станет общей и появится в общем пространстве дома."
    >
      <VisibilityPicker
        legend="Кому показать"
        value={choice}
        options={SHARE_OPTIONS}
        onChange={setChoice}
      />
      <p className="muted sheet__block">
        Вернуть заметку в личное сможете только вы, и только пока в ней не правили другие.
      </p>
      <NoteError error={state.error} action="share" />
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={state.disabled || householdId === null}
        onClick={() =>
          void state.run(async () => {
            if (householdId === null || choice === 'personal') return;
            await shareNote(card.id, householdId, choice);
            await refresh();
            toast.show(accessToast('Заметка стала общей', choice, scope, () => setScope('all')));
            onClose();
          })
        }
      >
        {state.pending ? 'Делимся…' : 'Поделиться'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

function AudienceSheet({ card, onClose }: { card: NoteCard; onClose: () => void }) {
  const { scope, setScope } = useScope();
  const refresh = useRefreshNotes();
  const toast = useToast();
  const state = useAction();
  const current = visibilityOf(card);
  const [choice, setChoice] = useState<Visibility>(current === 'adults' ? 'household' : 'adults');
  // Расширять доступ можно без подтверждения; сужение до «Взрослых» показывает, кто его потеряет.
  const narrowing = choice === 'adults' && current !== 'adults';
  const preview = useQuery({
    queryKey: ['notes', 'preview', card.id, card.updatedAt, 'adults'],
    queryFn: () => previewAccess(card.id, { action: 'audience', audience: 'adults' }),
    enabled: narrowing,
  });

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Кто видит заметку"
      description="Выберите, кто видит заметку в общем пространстве дома."
    >
      <VisibilityPicker
        value={choice}
        options={SHARE_OPTIONS}
        onChange={(value) => {
          state.setError(null);
          setChoice(value);
        }}
      />
      {narrowing && preview.isPending ? <Notice>Проверяем, кто потеряет доступ…</Notice> : null}
      {narrowing && preview.isError ? <NoteError error={preview.error} action="preview" /> : null}
      {narrowing && preview.data ? (
        <LosesAccess
          people={preview.data.losesAccess}
          empty="Никто из участников дома не потеряет доступ."
        />
      ) : null}
      <NoteError error={state.error} action="audience" />
      <button
        type="button"
        className={
          narrowing
            ? 'btn btn--danger btn--block sheet__next'
            : 'btn btn--primary btn--block sheet__next'
        }
        disabled={state.disabled || choice === current || (narrowing && !preview.data)}
        onClick={() =>
          void state.run(async () => {
            if (choice === 'personal') return;
            await changeAudience(card.id, choice, narrowing);
            await refresh();
            toast.show(
              accessToast(
                choice === 'adults' ? 'Заметку видят взрослые' : 'Заметку видит вся семья',
                choice,
                scope,
                () => setScope('all'),
              ),
            );
            onClose();
          })
        }
      >
        {state.pending ? 'Сохраняем…' : narrowing ? 'Сузить доступ' : 'Сохранить'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

function PersonalSheet({
  card,
  people,
  onClose,
}: {
  card: NoteCard;
  people: readonly { displayName: string }[] | undefined;
  onClose: () => void;
}) {
  const { scope, setScope } = useScope();
  const refresh = useRefreshNotes();
  const toast = useToast();
  const state = useAction();

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Сделать заметку личной"
      description="Видеть заметку будете только вы. Администратор и другие участники её не увидят."
    >
      {people ? (
        <LosesAccess
          people={people}
          empty="Никто не потеряет доступ: кроме вас, эту заметку никто в доме не видел."
        />
      ) : (
        <Notice error>Не удалось проверить, кто потеряет доступ. Закройте окно и повторите.</Notice>
      )}
      <NoteError error={state.error} action="personal" />
      <button
        type="button"
        className="btn btn--danger btn--block sheet__next"
        disabled={state.disabled || people === undefined}
        onClick={() =>
          void state.run(async () => {
            await makePersonal(card.id);
            await refresh();
            toast.show(
              accessToast('Заметка стала личной', 'personal', scope, () => setScope('all')),
            );
            onClose();
          })
        }
      >
        {state.pending ? 'Переносим…' : 'Сделать личной'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

interface NoteAccessProps {
  card: NoteCard;
  abilities: NoteAbilities;
}

/**
 * «Кто видит» в карточке и действия по правилам 7.3 (SPACE-7). Недоступное действие не
 * показывается; если «Сделать личной» закрыто чужим вкладом, сказано почему.
 */
export function NoteAccess({ card, abilities }: NoteAccessProps) {
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshNotes();
  const copying = useAction();
  const probe = useMakePersonalProbe(card.id, card.updatedAt, abilities.makePersonal);
  const visibility = visibilityOf(card);
  const close = () => setSheet(null);

  const showMakePersonal = abilities.makePersonal && !probe.pending && !probe.blocked;
  const blocked = abilities.makePersonal && probe.blocked;
  const anyAction = abilities.share || abilities.audience || showMakePersonal || abilities.copy;

  return (
    <>
      <div className="access-card">
        <h2 className="access-card__title">Кто видит</h2>
        <AccessCaption visibility={visibility} />
        {blocked ? (
          <p className="muted access-card__note">
            Сделать заметку личной нельзя: в ней есть правки других участников. Можно скопировать её
            в личное.
          </p>
        ) : null}
        {anyAction ? (
          <div className="btn-row">
            {abilities.share ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSheet('share')}
              >
                <ShareNetwork size={20} aria-hidden />
                Поделиться…
              </button>
            ) : null}
            {abilities.audience ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSheet('audience')}
              >
                <UsersThree size={20} aria-hidden />
                Кто видит…
              </button>
            ) : null}
            {showMakePersonal ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSheet('personal')}
              >
                <LockSimple size={20} aria-hidden />
                Сделать личной…
              </button>
            ) : null}
            {abilities.copy ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={copying.disabled}
                onClick={() =>
                  void copying.run(async () => {
                    const copy = await copyToPersonal(card.id);
                    await refresh();
                    toast.show({
                      message: 'Копия сохранена в личном',
                      detail: 'Кто видит копию: только вы',
                      action: {
                        label: 'Открыть',
                        onClick: () => navigate(`/more/notes/${copy.id}`),
                      },
                    });
                  })
                }
              >
                <Copy size={20} aria-hidden />
                {copying.pending ? 'Копируем…' : 'Скопировать в личное'}
              </button>
            ) : null}
          </div>
        ) : null}
        <NoteError error={copying.error} action="copy" />
      </div>
      {sheet === 'share' ? <ShareSheet card={card} onClose={close} /> : null}
      {sheet === 'audience' ? <AudienceSheet card={card} onClose={close} /> : null}
      {sheet === 'personal' ? (
        <PersonalSheet card={card} people={probe.preview?.losesAccess} onClose={close} />
      ) : null}
    </>
  );
}
