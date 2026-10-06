import { ROLE_LABELS, type Role } from '@homecrm/shared';
import { UserPlus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { createInvitation, type IssuedLink, revokeInvitation } from '../household/api.ts';
import { ActionError, IssuedLinkBox } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useInvitations, useRefresh } from '../household/queries.ts';
import { RoleChoice } from '../household/RoleChoice.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';

function PendingInvitations() {
  const { me } = useHousehold();
  const query = useInvitations(true);
  const refresh = useRefresh();
  const toast = useToast();
  const state = useAction();

  return (
    <Section title="Действующие приглашения">
      {query.isPending ? (
        <Notice>Загружаем приглашения…</Notice>
      ) : query.isError ? (
        <>
          <ActionError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку приглашений
          </button>
        </>
      ) : query.data.length === 0 ? (
        <p className="muted">Непринятых приглашений нет.</p>
      ) : (
        <RowList label="Действующие приглашения">
          {query.data.map((invitation) => (
            <Row
              key={invitation.id}
              icon={<UserPlus size={22} aria-hidden />}
              title={ROLE_LABELS[invitation.role]}
              meta={`Действует до ${formatMoment(invitation.expiresAt, me.timeZone)}`}
              aside={
                <button
                  type="button"
                  className="text-button"
                  disabled={state.disabled}
                  aria-label={`Отозвать приглашение: ${ROLE_LABELS[invitation.role]}, до ${formatMoment(invitation.expiresAt, me.timeZone)}`}
                  onClick={() =>
                    void state.run(async () => {
                      await revokeInvitation(invitation.id);
                      await refresh.invitations();
                      toast.show({ message: 'Приглашение отозвано' });
                    })
                  }
                >
                  Отозвать
                </button>
              }
            />
          ))}
        </RowList>
      )}
      <ActionError error={state.error} action="invite" />
    </Section>
  );
}

/**
 * Приглашение участника (AUTH-2, SPACE-8): администратор выбирает роль и получает одноразовую
 * ссылку на 72 часа. Сервер не хранит ссылку открытым текстом, поэтому её видно один раз.
 */
export function InviteScreen() {
  const { me, isAdmin, householdId } = useHousehold();
  const refresh = useRefresh();
  const state = useAction();
  const [role, setRole] = useState<Role>('adult');
  const [issued, setIssued] = useState<{ link: IssuedLink; role: Role } | null>(null);
  const back = { to: '/people', label: 'Люди' };

  if (!isAdmin || householdId === null) {
    return (
      <Page title="Приглашение" back={back}>
        <EmptyState icon={<UserPlus size={24} aria-hidden />} title="Приглашает администратор">
          <p>Пригласить нового участника в дом может только администратор дома.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Пригласить участника" back={back}>
      {issued ? (
        <Section title={`Приглашение: ${ROLE_LABELS[issued.role]}`}>
          <Notice>
            <strong>Ссылка показывается один раз.</strong> Если потеряете её, отзовите приглашение и
            создайте новое.
          </Notice>
          <IssuedLinkBox url={issued.link.url} what="ссылка-приглашение" />
          <p className="muted">
            Действует до {formatMoment(issued.link.expiresAt, me.timeZone)} и срабатывает один раз:
            по ней человек задаёт имя и пароль и входит в дом.
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--block list-action"
            onClick={() => setIssued(null)}
          >
            Создать ещё одно приглашение
          </button>
        </Section>
      ) : (
        <form
          className="invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            void state.run(async () => {
              const link = await createInvitation(householdId, role);
              setIssued({ link, role });
              await refresh.invitations();
            });
          }}
        >
          <RoleChoice value={role} onChange={setRole} legend="Кого приглашаем" />
          {role === 'admin' ? (
            <p className="muted">
              Администратору понадобится второй фактор — приложение попросит включить его при первом
              входе.
            </p>
          ) : null}
          <ActionError error={state.error} action="invite" />
          <button type="submit" className="btn btn--primary btn--block" disabled={state.disabled}>
            {state.pending ? 'Создаём…' : 'Создать ссылку-приглашение'}
          </button>
        </form>
      )}
      <PendingInvitations />
    </Page>
  );
}
