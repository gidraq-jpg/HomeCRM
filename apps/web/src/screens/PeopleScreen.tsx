import { ROLE_LABELS } from '@homecrm/shared';
import { AddressBook, Lock, UserPlus } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { ActionError, Avatar } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';

/** Вышел из дома, пока его не вернули приглашением: общие записи остаются под его именем. */
export function NoHousehold() {
  return (
    <EmptyState icon={<AddressBook size={24} aria-hidden />} title="Вы не состоите в доме">
      <p>
        Ваша учётная запись и личное пространство остались при вас. Общих записей дома вы больше не
        видите.
      </p>
      <p>Чтобы вернуться, попросите администратора дома прислать новое приглашение.</p>
    </EmptyState>
  );
}

function Members() {
  const { me, householdId } = useHousehold();
  const query = useMembers();

  if (householdId === null) return <NoHousehold />;
  if (query.isPending) return <Notice>Загружаем участников…</Notice>;
  if (query.isError) {
    return (
      <>
        <ActionError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку участников
        </button>
      </>
    );
  }

  const current = query.data.filter((member) => !member.formerMember);
  const former = query.data.filter((member) => member.formerMember);
  return (
    <>
      <Section title="Участники дома" aside={<span className="muted">{current.length}</span>}>
        <RowList label="Участники дома">
          {current.map((member) => (
            <Row
              key={member.accountId}
              to={`/people/members/${member.accountId}`}
              icon={<Avatar name={member.displayName} />}
              title={member.accountId === me.id ? `${member.displayName} (вы)` : member.displayName}
              meta={ROLE_LABELS[member.role]}
              badge="household"
            />
          ))}
        </RowList>
      </Section>
      {former.length > 0 ? (
        <Section title="Бывшие участники" aside={<span className="muted">{former.length}</span>}>
          <RowList label="Бывшие участники">
            {former.map((member) => (
              <Row
                key={member.accountId}
                to={`/people/members/${member.accountId}`}
                icon={<Avatar name={member.displayName} />}
                title={member.displayName}
                meta={
                  member.leftAt
                    ? `Вышел из дома ${formatDay(member.leftAt, me.timeZone)}`
                    : 'Вышел из дома'
                }
                aside={<Status tone="neutral">Бывший участник</Status>}
              />
            ))}
          </RowList>
        </Section>
      ) : null}
    </>
  );
}

/**
 * «Люди»: участники дома (SPACE-8…10). Контактов — организаций и мастеров — в приложении
 * ещё нет, экран говорит об этом прямо.
 */
export function PeopleScreen() {
  const { scope, setScope } = useScope();
  const { isAdmin } = useHousehold();
  // Участники дома — часть общего пространства: в режиме «Личное» их нет.
  const showMembers = scope !== 'personal';

  return (
    <Page title="Люди">
      {showMembers ? (
        <Members />
      ) : (
        <EmptyState icon={<Lock size={24} aria-hidden />} title="В режиме «Личное» людей нет">
          <p>
            Участники дома входят в общее пространство, а здесь только ваши записи. Личных контактов
            в приложении пока нет.
          </p>
          <p>{EMPTY_SCOPE_EXPLANATION.personal}</p>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setScope('all')}
          >
            Показать «{SCOPE_LABELS.all}»
          </button>
        </EmptyState>
      )}

      {showMembers && isAdmin ? (
        <Link className="btn btn--primary btn--block list-action" to="/people/invite">
          <UserPlus size={20} aria-hidden />
          Пригласить участника
        </Link>
      ) : null}

      {showMembers ? (
        <Section title="Организации и мастера">
          <p className="muted">
            Контактов пока нет: добавлять организации, мастеров и личные контакты в приложении пока
            нельзя.
          </p>
        </Section>
      ) : null}
    </Page>
  );
}
