import { useId, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { saveTimeZone } from '../deadlines/api.ts';
import { DeadlineError } from '../deadlines/components.tsx';
import { useRefreshDeadlines } from '../deadlines/queries.ts';
import { NoHousehold } from '../screens/PeopleScreen.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useHousehold } from './HouseholdContext.tsx';
import { HOME_ZONES, zoneLabel } from './zones.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;

/**
 * «Настройки дома»: часовой пояс дома (DEAD-6). По нему считаются сроки и радар и показываются все даты.
 * Менять его может администратор, остальные видят выбранный пояс.
 */
export function HouseScreen() {
  const { me, householdId, isAdmin, reloadMe } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshDeadlines();
  const save = useAction();
  const [zone, setZone] = useState(me.timeZone);
  const selectId = useId();

  if (householdId === null) {
    return (
      <Page title="Настройки дома" back={BACK}>
        <NoHousehold />
      </Page>
    );
  }

  const options = HOME_ZONES.some((item) => item.id === me.timeZone)
    ? HOME_ZONES.map((item) => item.id)
    : [me.timeZone, ...HOME_ZONES.map((item) => item.id)];
  const changed = zone !== me.timeZone;

  function submit() {
    if (householdId === null) return;
    void save.run(async () => {
      await saveTimeZone(householdId, zone);
      await reloadMe();
      await refresh();
      toast.show({
        message: 'Часовой пояс дома изменён',
        detail: 'Сроки пересчитываются: радар обновится в течение нескольких минут.',
      });
    });
  }

  return (
    <Page title="Настройки дома" back={BACK}>
      <Section title="Часовой пояс дома">
        <p className="muted">
          По нему считаются сроки и радар, и в нём показываются даты и время на всех экранах.
        </p>
        <dl className="facts">
          <div className="facts__item">
            <dt>Сейчас</dt>
            <dd>{zoneLabel(me.timeZone)}</dd>
          </div>
        </dl>
        {isAdmin ? (
          <form
            className="house-zone"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            aria-busy={save.pending}
          >
            <div className="field">
              <label className="field__label" htmlFor={selectId}>
                Новый часовой пояс
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
            <button
              type="submit"
              className="btn btn--primary btn--block house-zone__save"
              disabled={save.disabled || !changed}
            >
              {save.pending ? 'Сохраняем…' : 'Сохранить часовой пояс'}
            </button>
          </form>
        ) : (
          <Notice>Менять часовой пояс дома может только администратор.</Notice>
        )}
      </Section>
    </Page>
  );
}
