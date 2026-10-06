import { ROLE_LABELS } from '@homecrm/shared';
import { Phone } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { AccessCaption } from '../access/AccessBadge.tsx';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { ActionError, Avatar } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { CopyButton } from '../ui/CopyButton.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { type DateOnly, formatFullDate, toTelHref } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Status } from '../ui/Row.tsx';
import { AdminActions } from './AdminActions.tsx';

/** Дата рождения приходит как `YYYY-MM-DD`; всё остальное считаем отсутствием даты. */
function birthDateText(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatFullDate(value as DateOnly)
    : null;
}

/** Карточка участника: имя, фото-заглушка, роль, дата рождения, телефон (SPACE-10). */
export function MemberScreen() {
  const { accountId } = useParams();
  const { me, isAdmin } = useHousehold();
  const query = useMembers();
  const back = { to: '/people', label: 'Люди' };

  if (query.isPending) {
    return (
      <Page title="Участник" back={back}>
        <Notice>Загружаем участника…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Участник" back={back}>
        <ActionError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку
        </button>
      </Page>
    );
  }
  const member = query.data.find((item) => item.accountId === accountId);
  if (member === undefined) {
    return (
      <Page title="Участник не найден" back={back}>
        <EmptyState title="Такого участника нет">
          <p>Возможно, он ушёл из дома, а ссылка устарела.</p>
        </EmptyState>
      </Page>
    );
  }

  const isMe = member.accountId === me.id;
  const birth = birthDateText(member.birthDate);
  return (
    <Page
      title={member.displayName}
      eyebrow={isMe ? 'Это вы' : ROLE_LABELS[member.role]}
      back={back}
    >
      <div className="member-head">
        <Avatar name={member.displayName} large />
        <div className="member-head__text">
          {member.formerMember ? (
            <Status tone="neutral">Бывший участник</Status>
          ) : (
            <Status tone="ok">{ROLE_LABELS[member.role]}</Status>
          )}
          {member.formerMember && member.leftAt ? (
            <p className="muted">Вышел из дома {formatDay(member.leftAt, me.timeZone)}</p>
          ) : null}
        </div>
      </div>

      {member.phone && !member.formerMember ? (
        <div className="btn-row btn-row--first">
          <a className="btn btn--primary" href={toTelHref(member.phone)}>
            <Phone size={20} weight="fill" aria-hidden />
            Позвонить
          </a>
        </div>
      ) : null}

      <Section title="О человеке">
        <dl className="facts">
          <div className="facts__item">
            <dt>Роль</dt>
            <dd>{ROLE_LABELS[member.role]}</dd>
          </div>
          {member.formerMember ? null : (
            <>
              <div className="facts__item">
                <dt>Дата рождения</dt>
                <dd>{birth ?? 'Не указана'}</dd>
              </div>
              <div className="facts__item">
                <dt>Телефон</dt>
                <dd>
                  {member.phone ? (
                    <>
                      <a href={toTelHref(member.phone)} className="mono">
                        {member.phone}
                      </a>
                      <CopyButton value={member.phone} what="телефон" />
                    </>
                  ) : (
                    'Не указан'
                  )}
                </dd>
              </div>
            </>
          )}
        </dl>
        {member.formerMember ? (
          <p className="muted">
            Фото, дата рождения и телефон бывшего участника в доме не показываются. Сохраняется
            только имя: оно нужно, чтобы общие записи оставались понятными.
          </p>
        ) : null}
      </Section>

      <AccessCaption visibility="household" />
      <p className="muted">Имя, фото, дата рождения и телефон видны всей семье.</p>
      {isMe ? (
        <Link className="text-button" to="/more/profile">
          Изменить в «Обо мне»
        </Link>
      ) : null}

      {isAdmin && !member.formerMember ? <AdminActions member={member} isMe={isMe} /> : null}
    </Page>
  );
}
