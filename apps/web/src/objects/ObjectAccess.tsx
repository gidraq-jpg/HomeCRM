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
import { visibilityOf } from '../notes/abilities.ts';
import { LosesAccess } from '../notes/NoteAccess.tsx';
import { accessToast } from '../notes/toasts.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { ObjectAbilities } from './abilities.ts';
import {
  changeObjectAudience,
  copyObjectToPersonal,
  makeObjectPersonal,
  type ObjectCard,
  previewObjectAccess,
  shareObject,
} from './api.ts';
import { ObjectError } from './components.tsx';
import { useObjectMakePersonalProbe, useRefreshObjects } from './queries.ts';

type SheetName = 'share' | 'audience' | 'personal';

const SHARE_OPTIONS: readonly Visibility[] = ['adults', 'household'];

function ShareSheet({ card, onClose }: { card: ObjectCard; onClose: () => void }) {
  const { householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const refresh = useRefreshObjects();
  const toast = useToast();
  const state = useAction();
  const [choice, setChoice] = useState<Visibility>('adults');

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Поделиться объектом"
      description="Выберите, кому показать объект. Он станет общим вместе со своими полями и событиями ленты."
    >
      <VisibilityPicker
        legend="Кому показать"
        value={choice}
        options={SHARE_OPTIONS}
        onChange={setChoice}
      />
      <p className="muted sheet__block">
        Вернуть объект в личное сможете только вы, и только пока в нём не правили другие.
      </p>
      <ObjectError error={state.error} action="share" />
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={state.disabled || householdId === null}
        onClick={() =>
          void state.run(async () => {
            if (householdId === null || choice === 'personal') return;
            await shareObject(card.id, householdId, choice);
            await refresh();
            toast.show(accessToast('Объект стал общим', choice, scope, () => setScope('all')));
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

function AudienceSheet({ card, onClose }: { card: ObjectCard; onClose: () => void }) {
  const { scope, setScope } = useScope();
  const refresh = useRefreshObjects();
  const toast = useToast();
  const state = useAction();
  const current = visibilityOf(card);
  const [choice, setChoice] = useState<Visibility>(current === 'adults' ? 'household' : 'adults');
  // Расширять доступ можно без подтверждения; сужение до «Взрослых» показывает, кто его потеряет.
  const narrowing = choice === 'adults' && current !== 'adults';
  const preview = useQuery({
    queryKey: ['objects', 'preview', card.id, card.updatedAt, 'adults'],
    queryFn: () => previewObjectAccess(card.id, { action: 'audience', audience: 'adults' }),
    enabled: narrowing,
  });

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Кто видит объект"
      description="Выберите, кто видит объект в общем пространстве дома."
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
      {narrowing && preview.isError ? <ObjectError error={preview.error} action="preview" /> : null}
      {narrowing && preview.data ? (
        <LosesAccess
          what="Объект"
          people={preview.data.losesAccess}
          empty="Никто из участников дома не потеряет доступ."
        />
      ) : null}
      <ObjectError error={state.error} action="audience" />
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
            await changeObjectAudience(card.id, choice, narrowing);
            await refresh();
            toast.show(
              accessToast(
                choice === 'adults' ? 'Объект видят взрослые' : 'Объект видит вся семья',
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
  card: ObjectCard;
  people: readonly { displayName: string }[] | undefined;
  onClose: () => void;
}) {
  const { scope, setScope } = useScope();
  const refresh = useRefreshObjects();
  const toast = useToast();
  const state = useAction();

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Сделать объект личным"
      description="Видеть объект будете только вы. Администратор и другие участники его не увидят."
    >
      {people ? (
        <LosesAccess
          what="Объект"
          people={people}
          empty="Никто не потеряет доступ: кроме вас, этот объект никто в доме не видел."
        />
      ) : (
        <Notice error>Не удалось проверить, кто потеряет доступ. Закройте окно и повторите.</Notice>
      )}
      <ObjectError error={state.error} action="personal" />
      <button
        type="button"
        className="btn btn--danger btn--block sheet__next"
        disabled={state.disabled || people === undefined}
        onClick={() =>
          void state.run(async () => {
            await makeObjectPersonal(card.id);
            await refresh();
            toast.show(accessToast('Объект стал личным', 'personal', scope, () => setScope('all')));
            onClose();
          })
        }
      >
        {state.pending ? 'Переносим…' : 'Сделать личным'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

interface ObjectAccessProps {
  card: ObjectCard;
  abilities: ObjectAbilities;
}

/**
 * «Кто видит» в карточке и действия по правилам 7.3 (SPACE-7). Недоступное действие не
 * показывается; если «Сделать личным…» закрыто чужим вкладом, сказано почему.
 */
export function ObjectAccess({ card, abilities }: ObjectAccessProps) {
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const copying = useAction();
  const probe = useObjectMakePersonalProbe(card.id, card.updatedAt, abilities.makePersonal);
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
            Сделать объект личным нельзя: в нём есть правки других участников. Можно скопировать его
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
                Сделать личным…
              </button>
            ) : null}
            {abilities.copy ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={copying.disabled}
                onClick={() =>
                  void copying.run(async () => {
                    const copy = await copyObjectToPersonal(card.id);
                    await refresh();
                    toast.show({
                      message: 'Копия сохранена в личном',
                      detail: 'Кто видит копию: только вы',
                      action: {
                        label: 'Открыть',
                        onClick: () => navigate(`/home/${copy.id}`),
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
        <ObjectError error={copying.error} action="copy" />
      </div>
      {sheet === 'share' ? <ShareSheet card={card} onClose={close} /> : null}
      {sheet === 'audience' ? <AudienceSheet card={card} onClose={close} /> : null}
      {sheet === 'personal' ? (
        <PersonalSheet card={card} people={probe.preview?.losesAccess} onClose={close} />
      ) : null}
    </>
  );
}
