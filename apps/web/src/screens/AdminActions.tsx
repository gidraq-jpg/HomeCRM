import { ROLE_LABELS, type Role } from '@homecrm/shared';
import { Key, ShieldCheck, SignOut, UserSwitch } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import {
  changeRole,
  excludeMember,
  type IssuedLink,
  issueResetLink,
  type Member,
} from '../household/api.ts';
import { ActionError, IssuedLinkBox } from '../household/components.tsx';
import { isResponsibilityPending } from '../household/errors.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useRefresh } from '../household/queries.ts';
import { RoleChoice } from '../household/RoleChoice.tsx';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';

function RoleSheet({
  member,
  isMe,
  open,
  onClose,
}: {
  member: Member;
  isMe: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { householdId, reloadMe } = useHousehold();
  const refresh = useRefresh();
  const toast = useToast();
  const state = useAction();
  const [role, setRole] = useState<Role>(member.role);
  const changed = role !== member.role;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Сменить роль"
      description={`Роль участника: ${member.displayName}. Сейчас — ${ROLE_LABELS[member.role]}.`}
    >
      <RoleChoice value={role} onChange={setRole} />
      {isMe && changed ? (
        <Notice>
          После смены роли вы потеряете права администратора и не сможете вернуть их сами.
        </Notice>
      ) : null}
      <ActionError error={state.error} action="role" />
      <button
        type="button"
        className="btn btn--primary btn--block sheet__next"
        disabled={!changed || state.disabled}
        onClick={() =>
          void state.run(async () => {
            if (householdId === null) return;
            await changeRole(householdId, member.accountId, role);
            await refresh.members();
            if (isMe) await reloadMe();
            toast.show({ message: `Роль изменена: ${member.displayName} — ${ROLE_LABELS[role]}` });
            onClose();
          })
        }
      >
        {state.pending ? 'Сохраняем…' : 'Сохранить роль'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

function ExcludeSheet({
  member,
  open,
  onClose,
}: {
  member: Member;
  open: boolean;
  onClose: () => void;
}) {
  const { householdId } = useHousehold();
  const refresh = useRefresh();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useAction();

  return (
    <Sheet
      role="alertdialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Исключить из дома?"
      description={`${member.displayName} потеряет доступ к общим записям дома.`}
    >
      <ul className="bullets sheet__block">
        <li>
          Учётная запись и личное пространство остаются у самого участника: исключение их не
          затрагивает.
        </li>
        <li>Общие записи останутся в доме, а автор будет помечен как «бывший участник».</li>
        <li>Ответственность за записи участника перейдёт администратору.</li>
      </ul>
      <ActionError error={state.error} action="exclude" />
      <button
        type="button"
        className="btn btn--danger btn--block"
        disabled={state.disabled}
        onClick={() =>
          void state.run(async () => {
            if (householdId === null) return;
            let pending = false;
            try {
              await excludeMember(householdId, member.accountId);
            } catch (error) {
              // Исключение уже выполнено: не хватило только передачи ответственности.
              if (!isResponsibilityPending(error)) throw error;
              pending = true;
            }
            await refresh.members();
            toast.show({
              message: `Исключён из дома: ${member.displayName}`,
              ...(pending
                ? {
                    detail:
                      'Передача ответственности администратору завершится позже сама: повторять ничего не нужно.',
                    durationMs: 12_000,
                  }
                : {}),
            });
            onClose();
            navigate('/people');
          })
        }
      >
        {state.pending ? 'Исключаем…' : 'Исключить'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

function ResetSheet({
  member,
  open,
  onClose,
}: {
  member: Member;
  open: boolean;
  onClose: () => void;
}) {
  const { me, householdId } = useHousehold();
  const state = useAction();
  // Ссылка живёт только в памяти этого окна и пропадает вместе с ним.
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  function close() {
    setIssued(null);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Ссылка для сброса пароля"
      description={`Для ребёнка: ${member.displayName}. Ссылка действует 24 часа и срабатывает один раз.`}
    >
      {issued ? (
        <>
          <Notice>
            <strong>Ссылка показывается один раз.</strong> Закроете окно — её нельзя будет
            посмотреть снова, придётся выдать новую.
          </Notice>
          <IssuedLinkBox url={issued.url} what="ссылка для сброса пароля" />
          <p className="muted">
            Действует до {formatMoment(issued.expiresAt, me.timeZone)}. Передайте её только самому
            ребёнку.
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--block sheet__next"
            onClick={close}
          >
            Готово
          </button>
        </>
      ) : (
        <>
          <ul className="bullets sheet__block">
            <li>
              По ссылке можно задать новый пароль и войти от имени ребёнка, в том числе в его личное
              пространство.
            </li>
            <li>
              Ребёнок увидит отметку, что пароль сбрасывали. Первые 7 дней её не может закрыть
              никто.
            </li>
            <li>Прежние ссылки сброса для него перестанут работать.</li>
          </ul>
          <ActionError error={state.error} action="reset" />
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={state.disabled}
            onClick={() =>
              void state.run(async () => {
                if (householdId === null) return;
                setIssued(await issueResetLink(householdId, member.accountId));
              })
            }
          >
            {state.pending ? 'Выдаём…' : 'Выдать ссылку'}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block sheet__next"
            onClick={close}
          >
            Отмена
          </button>
        </>
      )}
    </Sheet>
  );
}

/**
 * Действия администратора над участником (SPACE-8, AUTH-5). Взрослому и ребёнку блок не
 * показывается; сервер в любом случае проверяет роль сам.
 */
export function AdminActions({ member, isMe }: { member: Member; isMe: boolean }) {
  const { me } = useHousehold();
  const [sheet, setSheet] = useState<'role' | 'exclude' | 'reset' | null>(null);
  const close = () => setSheet(null);

  return (
    <Section title="Для администратора">
      {me.twoFactorEnabled ? null : (
        <Notice>
          <strong>Нужен второй фактор.</strong> Управлять составом дома можно только после его
          включения.{' '}
          <Link className="text-button" to="/more/settings">
            Открыть «Настройки»
          </Link>
        </Notice>
      )}
      <div className="admin-actions">
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => setSheet('role')}
        >
          <UserSwitch size={20} aria-hidden />
          Сменить роль
        </button>
        {member.role === 'child' ? (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setSheet('reset')}
          >
            <Key size={20} aria-hidden />
            Ссылка для сброса пароля
          </button>
        ) : null}
        {isMe ? (
          <p className="muted">
            <ShieldCheck size={18} aria-hidden /> Уйти из дома можно в разделе «Обо мне».
          </p>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={() => setSheet('exclude')}
          >
            <SignOut size={20} aria-hidden />
            Исключить из дома
          </button>
        )}
      </div>
      {sheet === 'role' ? <RoleSheet member={member} isMe={isMe} open onClose={close} /> : null}
      {sheet === 'exclude' ? <ExcludeSheet member={member} open onClose={close} /> : null}
      {sheet === 'reset' ? <ResetSheet member={member} open onClose={close} /> : null}
    </Section>
  );
}
