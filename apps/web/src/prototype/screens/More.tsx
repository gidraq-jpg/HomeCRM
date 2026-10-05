import {
  ArrowCounterClockwise,
  Export,
  GearSix,
  Lock,
  Note,
  ShoppingCart,
  Target,
  Trash,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { VISIBILITIES, VISIBILITY_HINTS, VISIBILITY_LABELS } from '../../access/visibility.ts';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Page, Section } from '../../ui/Page.tsx';
import { Row, RowList } from '../../ui/Row.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { usePrototype, useRecords } from '../store.tsx';

/** «Ещё»: заметки, покупки, радар, настройки, корзина, экспорт и «Начать прототип заново». */
export function MoreScreen() {
  const notes = useRecords('note');
  const shopping = useRecords('shopping');
  const [resetting, setResetting] = useState(false);

  const openShopping = shopping.filter((item) => !item.bought).length;
  return (
    <Page title="Ещё" eyebrow="Под рукой">
      <RowList label="Разделы">
        <Row
          to="/more/notes"
          icon={<Note size={22} aria-hidden />}
          title="Заметки"
          meta={notes.length > 0 ? `Сейчас видно: ${notes.length}` : 'Личные и общие записи'}
        />
        <Row
          to="/more/shopping"
          icon={<ShoppingCart size={22} aria-hidden />}
          title="Покупки"
          meta={openShopping > 0 ? `Нужно купить: ${openShopping}` : 'Общий и личный списки'}
        />
        <Row
          to="/more/radar"
          icon={<Target size={22} aria-hidden />}
          title="Радар"
          meta="Сроки и всё, что требует внимания"
        />
        <Row
          to="/more/settings"
          icon={<GearSix size={22} aria-hidden />}
          title="Настройки"
          meta="Профиль, безопасность, уведомления"
        />
        <Row
          to="/more/trash"
          icon={<Trash size={22} aria-hidden />}
          title="Корзина"
          meta="Удалённое хранится 30 дней"
        />
        <Row
          to="/more/export"
          icon={<Export size={22} aria-hidden />}
          title="Экспорт"
          meta="Выгрузить свои данные"
        />
        <Row
          to="/more/spaces"
          icon={<Lock size={22} aria-hidden />}
          title="Как устроены личное и общее"
          meta="Кто что видит"
        />
      </RowList>

      <Section title="Пробная версия">
        <p className="muted">
          Это кликабельный прототип: данные вымышленные, сервера нет. Всё, что вы добавляете,
          хранится только в этом браузере.
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          onClick={() => setResetting(true)}
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          Начать прототип заново
        </button>
      </Section>

      <ResetSheet open={resetting} onClose={() => setResetting(false)} />
    </Page>
  );
}

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { resetPrototype } = usePrototype();
  const { resetScope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Sheet
      role="alertdialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Начать прототип заново?"
      description="Заметки, дела и другие изменения, сделанные в прототипе, пропадут. Переключатель вернётся на «Всё»."
    >
      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={() => {
          resetPrototype();
          resetScope();
          onClose();
          navigate('/today');
          toast.show({ message: 'Прототип начат заново' });
        }}
      >
        Начать заново
      </button>
      <button type="button" className="btn btn--secondary btn--block sheet__next" onClick={onClose}>
        Отмена
      </button>
    </Sheet>
  );
}

interface StubProps {
  title: string;
  icon: ReactNode;
  lead: string;
  points: readonly string[];
}

/** Заглушка раздела «Ещё»: что здесь будет, по PRD, без действий. */
function Stub({ title, icon, lead, points }: StubProps) {
  return (
    <Page title={title} back={{ to: '/more', label: 'Ещё' }}>
      <EmptyState icon={icon} title={lead}>
        <ul className="bullets">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </EmptyState>
      <p className="prototype-note">Этот раздел в прототипе — заглушка, действий в нём нет.</p>
    </Page>
  );
}

export function SettingsScreen() {
  return (
    <Stub
      title="Настройки"
      icon={<GearSix size={24} aria-hidden />}
      lead="Здесь будут настройки"
      points={[
        '«Обо мне»: имя, фото, дата рождения и телефон видны семье, остальное — только вам.',
        'Безопасность: пароль, второй фактор, список устройств, коды восстановления.',
        'Уведомления: тихие часы, дневной бюджет, скрытие текста на экране блокировки.',
        'Дом и участники — для администратора.',
        'Перенос из LifeOS и сведения о системе.',
      ]}
    />
  );
}

export function TrashScreen() {
  return (
    <Stub
      title="Корзина"
      icon={<Trash size={24} aria-hidden />}
      lead="Корзина пуста"
      points={[
        'Удалённое хранится 30 дней, потом исчезает.',
        'Личная корзина — только ваша: другие участники её не видят.',
        'Общая корзина — у всего дома: восстановить может администратор или автор записи.',
      ]}
    />
  );
}

export function ExportScreen() {
  return (
    <Stub
      title="Экспорт"
      icon={<Export size={24} aria-hidden />}
      lead="Выгрузить свои данные"
      points={[
        'Файл в открытом формате: JSON, а файлы — в архиве ZIP.',
        'Каждый выгружает своё личное; администратор — общее.',
        'Чужое личное в экспорт дома не попадает.',
        'Для выгрузки нужно ещё раз ввести пароль.',
      ]}
    />
  );
}

/** Короткое объяснение разницы личного и общего — «первый вход» из PRD, раздел 7.4 и 7.5. */
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
            <strong>{`${'Всё'}`}</strong> — всё, что вам доступно: личное и общее вместе, личное с
            замком.
          </li>
          <li>
            <strong>Общее</strong> — только записи дома: «{VISIBILITY_LABELS.adults}» и «
            {VISIBILITY_LABELS.household}».
          </li>
          <li>
            <strong>Личное</strong> — только ваши записи. В этом режиме новые записи тоже личные.
          </li>
        </ul>
      </Section>

      <Section title="Что важно знать">
        <ul className="bullets">
          <li>Администратор не видит чужое личное — так же, как любой другой участник.</li>
          <li>Личной записью можно поделиться, общую можно сделать личной — в карточке записи.</li>
          <li>Прежде чем сузить доступ, приложение покажет, кто его потеряет.</li>
        </ul>
        <p className="muted">
          Чего мы не обещаем: тот, кто администрирует сервер и имеет прямой доступ к базе и
          резервным копиям, технически может прочитать любые незашифрованные записи. В семейной
          установке это обычно администратор дома. То, что должно быть скрыто и от него, будет
          храниться в «Секретах» со сквозным шифрованием.
        </p>
      </Section>
    </Page>
  );
}
