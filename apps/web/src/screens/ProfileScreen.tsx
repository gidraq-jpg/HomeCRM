import { ROLE_LABELS } from '@homecrm/shared';
import { Phone, SignOut } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { useRefreshDeadlines } from '../deadlines/queries.ts';
import { leaveHousehold, type Profile, type ProfileChange, saveProfile } from '../household/api.ts';
import { ActionError, Avatar } from '../household/components.tsx';
import { isResponsibilityPending } from '../household/errors.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMyProfile, useRefresh } from '../household/queries.ts';
import { CheckLine } from '../ui/CheckLine.tsx';
import { CopyButton } from '../ui/CopyButton.tsx';
import { type DateOnly, formatFullDate, toTelHref } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { ProfilePhoto } from './ProfilePhoto.tsx';

function birthDateText(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatFullDate(value as DateOnly)
    : null;
}

function ProfileForm({
  profile,
  onCancel,
  onSaved,
}: {
  profile: Profile;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { reloadMe } = useHousehold();
  const refresh = useRefresh();
  const refreshDeadlines = useRefreshDeadlines();
  const [birthdayEnabled, setBirthdayEnabled] = useState(profile.birthdayEnabled);
  const toast = useToast();
  const state = useAction();
  const ids = { name: useId(), birth: useId(), phone: useId() };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? '').trim();
    const change: ProfileChange = {};
    if (birthdayEnabled !== profile.birthdayEnabled) change.birthdayEnabled = birthdayEnabled;
    if (text('displayName') !== profile.displayName) change.displayName = text('displayName');
    if ((text('birthDate') || null) !== profile.birthDate)
      change.birthDate = text('birthDate') || null;
    if ((text('phone') || null) !== profile.phone) change.phone = text('phone') || null;
    void state.run(async () => {
      if (Object.keys(change).length > 0) {
        await saveProfile(change);
        await Promise.all([refresh.profile(), refresh.members(), reloadMe(), refreshDeadlines()]);
        toast.show({ message: 'Профиль сохранён' });
      }
      onSaved();
    });
  }

  return (
    <form className="profile-form" onSubmit={submit} aria-busy={state.pending}>
      <label className="field" htmlFor={ids.name}>
        <span className="field__label">Имя</span>
        <input
          id={ids.name}
          className="input"
          name="displayName"
          defaultValue={profile.displayName}
          required
          maxLength={100}
          autoComplete="name"
        />
      </label>
      <label className="field" htmlFor={ids.birth}>
        <span className="field__label">Дата рождения</span>
        <input
          id={ids.birth}
          className="input"
          name="birthDate"
          type="date"
          defaultValue={profile.birthDate ?? ''}
          autoComplete="bday"
        />
      </label>
      <label className="field" htmlFor={ids.phone}>
        <span className="field__label">Телефон</span>
        <input
          id={ids.phone}
          className="input"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={profile.phone ?? ''}
          maxLength={40}
          autoComplete="tel"
        />
      </label>
      <CheckLine checked={birthdayEnabled} onChange={setBirthdayEnabled}>
        Напоминать о дне рождения
      </CheckLine>
      <ActionError error={state.error} action="profile" />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary" disabled={state.disabled}>
          {state.pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function LeaveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { householdId, reloadMe } = useHousehold();
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
      title="Уйти из дома?"
      description="Вы потеряете доступ к общим записям дома. Вернуться можно только по новому приглашению."
    >
      <p className="sheet__lead">Что останется у вас:</p>
      <ul className="bullets sheet__block">
        <li>Учётная запись и личное пространство: личные записи никуда не денутся.</li>
        <li>Вход в приложение и ваш профиль.</li>
      </ul>
      <p className="sheet__lead">Что останется в доме:</p>
      <ul className="bullets sheet__block">
        <li>Общие записи, которые вы создали, под вашим именем с пометкой «бывший участник».</li>
        <li>Ответственность за ваши записи перейдёт администратору.</li>
      </ul>
      <ActionError error={state.error} action="leave" />
      <button
        type="button"
        className="btn btn--danger btn--block"
        disabled={state.disabled}
        onClick={() =>
          void state.run(async () => {
            if (householdId === null) return;
            let pending = false;
            try {
              await leaveHousehold(householdId);
            } catch (error) {
              // Уход уже выполнен: не хватило только передачи ответственности администратору.
              if (!isResponsibilityPending(error)) throw error;
              pending = true;
            }
            await reloadMe();
            toast.show({
              message: 'Вы вышли из дома',
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
        {state.pending ? 'Выходим…' : 'Уйти из дома'}
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

/**
 * «Обо мне» (SPACE-10): имя, фото, дата рождения и телефон видны семье, остальное — только
 * владельцу. Фото загружается, меняется, снимается и возвращается здесь же (ProfilePhoto).
 */
export function ProfileScreen() {
  const { me, householdId, role } = useHousehold();
  const query = useMyProfile();
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const back = { to: '/more', label: 'Ещё' };

  if (query.isPending) {
    return (
      <Page title="Обо мне" back={back}>
        <Notice>Загружаем профиль…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Обо мне" back={back}>
        <ActionError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку профиля
        </button>
      </Page>
    );
  }

  // Строки профиля может не быть: тогда показываем то, что известно из входа.
  const profile: Profile = query.data ?? {
    displayName: me.displayName,
    photoFileId: null,
    birthDate: null,
    birthdayEnabled: false,
    phone: null,
  };
  const birth = birthDateText(profile.birthDate);

  return (
    <Page title="Обо мне" back={back}>
      <div className="member-head">
        <Avatar name={profile.displayName} large photoFileId={profile.photoFileId} />
        <div className="member-head__text">
          <p className="member-head__name">{profile.displayName}</p>
        </div>
      </div>

      <ProfilePhoto photoFileId={profile.photoFileId} />

      <Section title="Профиль">
        {editing ? (
          <ProfileForm
            profile={profile}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : (
          <>
            <dl className="facts">
              <div className="facts__item">
                <dt>Имя</dt>
                <dd>{profile.displayName}</dd>
              </div>
              <div className="facts__item">
                <dt>Дата рождения</dt>
                <dd>{birth ?? 'Не указана'}</dd>
              </div>
              <div className="facts__item">
                <dt>Телефон</dt>
                <dd>
                  {profile.phone ? (
                    <>
                      <a href={toTelHref(profile.phone)} className="mono">
                        {profile.phone}
                      </a>
                      <CopyButton value={profile.phone} what="телефон" />
                    </>
                  ) : (
                    'Не указан'
                  )}
                </dd>
              </div>
            </dl>
            <div className="btn-row">
              <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
                Изменить
              </button>
              {profile.phone ? (
                <a className="btn btn--secondary" href={toTelHref(profile.phone)}>
                  <Phone size={20} aria-hidden />
                  Позвонить
                </a>
              ) : null}
            </div>
          </>
        )}
      </Section>

      <Section title="Кто это видит">
        <ul className="visibility-list">
          <li>
            <AccessBadge visibility="household" showLabel />
            <p>Имя, фото, дата рождения и телефон: видят все в доме.</p>
          </li>
          <li>
            <AccessBadge visibility="personal" showLabel />
            <p>Всё остальное в вашем профиле: логин, почта, устройства и журнал входов.</p>
          </li>
        </ul>
      </Section>

      <Section title="Дом">
        {householdId === null || role === null ? (
          <p className="muted">Вы не состоите в доме. Ваше личное пространство осталось при вас.</p>
        ) : (
          <>
            <p className="muted">Ваша роль в доме: {ROLE_LABELS[role]}.</p>
            <button
              type="button"
              className="btn btn--danger btn--block list-action"
              onClick={() => setLeaving(true)}
            >
              <SignOut size={20} aria-hidden />
              Уйти из дома
            </button>
          </>
        )}
      </Section>
      {leaving ? <LeaveSheet open onClose={() => setLeaving(false)} /> : null}
    </Page>
  );
}
