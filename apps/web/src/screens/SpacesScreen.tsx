import { AccessBadge } from '../access/AccessBadge.tsx';
import { VISIBILITIES, VISIBILITY_HINTS, VISIBILITY_LABELS } from '../access/visibility.ts';
import { Page, Section } from '../ui/Page.tsx';

/** Короткое объяснение разницы личного и общего — PRD, разделы 7.4 и 7.5. */
export function SpacesScreen() {
  return (
    <Page title="Как устроены личное и общее" back={{ to: '/more', label: 'Ещё' }}>
      <p className="muted">
        У каждого участника есть личное пространство, у семьи — общее пространство дома. Любая
        запись лежит ровно в одном из них.
      </p>

      <Section title="Три значка">
        <ul className="spaces-list">
          {VISIBILITIES.map((visibility) => (
            <li key={visibility}>
              <AccessBadge visibility={visibility} showLabel />
              <p>{VISIBILITY_HINTS[visibility]}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Переключатель вверху">
        <ul className="bullets">
          <li>
            <strong>Всё</strong> — всё, что вам доступно: личное и общее вместе, личное с замком.
          </li>
          <li>
            <strong>Общее</strong> — только записи дома: «{VISIBILITY_LABELS.adults}» и «
            {VISIBILITY_LABELS.household}».
          </li>
          <li>
            <strong>Личное</strong> — только ваши записи. В этом режиме новые записи тоже личные.
          </li>
        </ul>
        <p className="muted">Выбор запоминается на этом устройстве.</p>
      </Section>

      <Section title="Что важно знать">
        <ul className="bullets">
          <li>Администратор не видит чужое личное — так же, как любой другой участник.</li>
          <li>
            Поделиться личной записью может только её владелец. Сделать общую запись личной может
            только её автор, и только если другие в ней ничего не меняли.
          </li>
          <li>Перед сужением доступа приложение показывает, кто его потеряет.</li>
          <li>Имя, фото, дата рождения и телефон из «Обо мне» видит вся семья.</li>
        </ul>
      </Section>

      <Section title="Чего мы не обещаем">
        <p className="muted">
          Тот, кто администрирует сервер и имеет прямой доступ к базе и резервным копиям, технически
          может прочитать любые незашифрованные записи. В семейной установке это обычно
          администратор дома. То, что должно быть скрыто и от него, будет храниться в «Секретах» со
          сквозным шифрованием.
        </p>
      </Section>
    </Page>
  );
}
