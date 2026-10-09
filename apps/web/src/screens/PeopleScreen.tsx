import { ROLE_LABELS } from '@homecrm/shared';
import { AddressBook, UserPlus } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { ActionError, Avatar } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { ContactsList } from '../people/ContactsList.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
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
              icon={<Avatar name={member.displayName} photoFileId={member.photoFileId} />}
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
                icon={<Avatar name={member.displayName} photoFileId={member.photoFileId} />}
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
 * «Люди»: участники дома (SPACE-8…10) и контакты — люди и организации (CONT-1, CONT-2) с поиском
 * и фильтром по категории.
 */
export function PeopleScreen() {
  const { scope } = useScope();
  const { isAdmin } = useHousehold();
  // Участники дома — часть общего пространства: в режиме «Личное» их нет.
  const showMembers = scope !== 'personal';

  return (
    <Page title="Люди">
      {showMembers ? <Members /> : null}

      {showMembers && isAdmin ? (
        <Link className="btn btn--primary btn--block list-action" to="/people/invite">
          <UserPlus size={20} aria-hidden />
          Пригласить участника
        </Link>
      ) : null}

      <ContactsList />
    </Page>
  );
}
