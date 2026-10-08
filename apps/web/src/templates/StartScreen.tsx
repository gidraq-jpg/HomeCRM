import { ROLE_LABELS, type Role } from '@homecrm/shared';
import { type ReactNode, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { saveTimeZone } from '../deadlines/api.ts';
import { DeadlineError } from '../deadlines/components.tsx';
import { useRefreshDeadlines } from '../deadlines/queries.ts';
import { createInvitation, type IssuedLink } from '../household/api.ts';
import { ActionError, IssuedLinkBox } from '../household/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useRefresh } from '../household/queries.ts';
import { RoleChoice } from '../household/RoleChoice.tsx';
import { HOME_ZONES, zoneLabel } from '../household/zones.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { TemplateRows } from './NewFromTemplateScreen.tsx';
import { useOnboarding, useRefreshAfterTemplate, useTemplates } from './queries.ts';
import { TemplateForm } from './TemplateForm.tsx';

// Первый запуск администратора (TPL-1): дом, шаблон, первый объект, приглашения. Каждый шаг можно
// пропустить. Прогресс — в адресе страницы и на сервере (создан ли объект), а не в localStorage:
// после перезагрузки мастер продолжается с того же шага, а созданное уже лежит в доме.

export const STEPS = ['house', 'template', 'object', 'invite'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Readonly<Record<Step, string>> = {
  house: 'Дом',
  template: 'Шаблон',
  object: 'Первый объект',
  invite: 'Приглашения',
};

const FINISH = '/today';
const pathOf = (step: Step, rest = '') => `/start/${step}${rest}`;

function isStep(value: string | undefined): value is Step {
  return (STEPS as readonly (string | undefined)[]).includes(value);
}

function Progress({ step }: { step: Step }) {
  const index = STEPS.indexOf(step);
  return (
    <nav className="start-steps" aria-label={`Шаг ${index + 1} из ${STEPS.length}`}>
      <ol>
        {STEPS.map((item, position) => (
          <li
            key={item}
            className={
              position === index
                ? 'start-steps__item start-steps__item--current'
                : 'start-steps__item'
            }
            {...(position === index ? { 'aria-current': 'step' as const } : {})}
          >
            <span className="start-steps__number" aria-hidden>
              {position + 1}
            </span>
            <span>{STEP_TITLES[item]}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StepBody({ children }: { children: ReactNode }) {
  return <div className="start-step">{children}</div>;
}

function HouseStep() {
  const { me, householdId, reloadMe } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshDeadlines();
  const save = useAction();
  const [zone, setZone] = useState(me.timeZone);
  const selectId = useId();
  const options = HOME_ZONES.some((item) => item.id === me.timeZone)
    ? HOME_ZONES.map((item) => item.id)
    : [me.timeZone, ...HOME_ZONES.map((item) => item.id)];

  function next() {
    navigate(pathOf('template'));
  }

  function submit() {
    if (householdId === null || zone === me.timeZone) {
      next();
      return;
    }
    void save.run(async () => {
      await saveTimeZone(householdId, zone);
      await reloadMe();
      await refresh();
      toast.show({ message: 'Часовой пояс дома сохранён' });
      next();
    });
  }

  return (
    <StepBody>
      <p className="muted">
        Дом создан при регистрации. Проверьте часовой пояс: по нему считаются сроки, радар и
        предупреждения.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        aria-busy={save.pending}
      >
        <div className="field">
          <label className="field__label" htmlFor={selectId}>
            Часовой пояс дома
          </label>
          <select
            id={selectId}
            className="select"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            {options.map((id) => (
              <option key={id} value={id}>
                {zoneLabel(id)}
              </option>
            ))}
          </select>
        </div>
        <DeadlineError error={save.error} action="zone" />
        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={save.disabled}>
            {save.pending ? 'Сохраняем…' : 'Дальше'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={next}>
            Пропустить
          </button>
        </div>
      </form>
    </StepBody>
  );
}

function TemplateStep() {
  const query = useTemplates();
  const navigate = useNavigate();
  return (
    <StepBody>
      <p className="muted">
        Шаблон сразу заведёт первый объект со счетами, счётчиками и сроками. Лишнее снимается
        галочками на следующем шаге.
      </p>
      {query.isPending ? <Notice>Загружаем шаблоны…</Notice> : null}
      {query.isError ? (
        <>
          <Notice error>Не удалось загрузить шаблоны. Проверьте подключение и повторите.</Notice>
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку шаблонов
          </button>
        </>
      ) : null}
      {query.data ? (
        <TemplateRows templates={query.data} hrefOf={(item) => pathOf('object', `/${item.id}`)} />
      ) : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => navigate(pathOf('invite'))}
        >
          Пропустить
        </button>
      </div>
    </StepBody>
  );
}

function ObjectStep() {
  const { templateId } = useParams();
  const query = useTemplates();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshAfterTemplate();

  if (query.isPending) return <Notice>Загружаем шаблоны…</Notice>;
  const template = query.data?.find((item) => item.id === templateId);
  if (template === undefined) return <Navigate to={pathOf('template')} replace />;
  return (
    <StepBody>
      <p className="muted">Шаблон: {template.title}.</p>
      <TemplateForm
        template={template}
        submitLabel="Создать объект"
        onSkip={() => navigate(pathOf('invite'))}
        onCreated={async () => {
          await refresh();
          toast.show({ message: 'Первый объект создан' });
          navigate(pathOf('invite'), { replace: true });
        }}
      />
    </StepBody>
  );
}

function InviteStep() {
  const { me, householdId } = useHousehold();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const state = useAction();
  const [role, setRole] = useState<Role>('adult');
  const [issued, setIssued] = useState<{ id: number; link: IssuedLink; role: Role }[]>([]);

  return (
    <StepBody>
      <p className="muted">
        Пригласите тех, кто будет вести дом вместе с вами. Приглашение можно создать и позже, в
        разделе «Люди».
      </p>
      {issued.map(({ id, link, role: issuedRole }) => (
        <div key={id} className="start-invite">
          <Notice>
            <strong>Приглашение: {ROLE_LABELS[issuedRole]}.</strong> Ссылка показывается один раз;
            действует до {formatMoment(link.expiresAt, me.timeZone)}.
          </Notice>
          <IssuedLinkBox url={link.url} what={`ссылка-приглашение ${id}`} />
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (householdId === null) return;
          void state.run(async () => {
            const link = await createInvitation(householdId, role);
            setIssued((previous) => [...previous, { id: previous.length + 1, link, role }]);
            await refresh.invitations();
          });
        }}
      >
        <RoleChoice value={role} onChange={setRole} legend="Кого приглашаем" />
        <ActionError error={state.error} action="invite" />
        <button type="submit" className="btn btn--secondary btn--block" disabled={state.disabled}>
          {state.pending ? 'Создаём…' : 'Создать ссылку-приглашение'}
        </button>
      </form>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={() => navigate(FINISH)}>
          {issued.length > 0 ? 'Готово' : 'Пропустить и закончить'}
        </button>
      </div>
    </StepBody>
  );
}

function Wizard({ step }: { step: Step }) {
  return (
    <Page title={STEP_TITLES[step]} eyebrow="Первый запуск" back={{ to: FINISH, label: 'Сегодня' }}>
      <Progress step={step} />
      {step === 'house' ? <HouseStep /> : null}
      {step === 'template' ? <TemplateStep /> : null}
      {step === 'object' ? <ObjectStep /> : null}
      {step === 'invite' ? <InviteStep /> : null}
    </Page>
  );
}

/**
 * Мастер первого запуска администратора. Без шага в адресе открывается тот, где остановились:
 * если объект в доме уже есть, шаги «Шаблон» и «Первый объект» пройдены.
 */
export function StartScreen({ fixedStep }: { fixedStep?: Step }) {
  const { step: param } = useParams();
  const step = fixedStep ?? param;
  const { isAdmin } = useHousehold();
  const onboarding = useOnboarding();

  if (!isAdmin) {
    return (
      <Page title="Первый запуск" back={{ to: FINISH, label: 'Сегодня' }}>
        <EmptyState title="Настраивает дом администратор">
          <p>Первый объект и приглашения создаёт администратор дома.</p>
          <Link className="text-button" to="/home/from-template">
            Создать объект из шаблона
          </Link>
        </EmptyState>
      </Page>
    );
  }
  if (isStep(step)) return <Wizard step={step} />;
  if (onboarding.isPending) {
    return (
      <Page title="Первый запуск" back={{ to: FINISH, label: 'Сегодня' }}>
        <Notice>Загружаем…</Notice>
      </Page>
    );
  }
  return (
    <Navigate
      to={pathOf(onboarding.data?.needsFirstObject === false ? 'invite' : 'house')}
      replace
    />
  );
}
