import {
  BellRinging,
  CalendarCheck,
  Export,
  GearSix,
  House,
  Lock,
  Note,
  Trash,
  UserCircle,
} from '@phosphor-icons/react';
import { Page } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';

/** «Ещё»: то, что в приложении уже работает. Покупки — позже. */
export function MoreScreen() {
  return (
    <Page title="Ещё" eyebrow="Под рукой">
      <RowList label="Разделы">
        <Row
          to="/more/notes"
          icon={<Note size={22} aria-hidden />}
          title="Заметки"
          meta="Личные и общие, с чек-листом"
        />
        <Row
          to="/more/radar"
          icon={<CalendarCheck size={22} aria-hidden />}
          title="Радар"
          meta="Сроки: просрочено, сейчас, 7, 30 и 90 дней"
        />
        <Row
          to="/more/notifications"
          icon={<BellRinging size={22} aria-hidden />}
          title="Уведомления"
          meta="Push на телефон, тихие часы, журнал доставки"
        />
        <Row
          to="/more/trash"
          icon={<Trash size={22} aria-hidden />}
          title="Корзина"
          meta="Удалённые заметки и объекты хранятся 30 дней"
        />
        <Row
          to="/more/house"
          icon={<House size={22} aria-hidden />}
          title="Настройки дома"
          meta="Часовой пояс, по которому считаются сроки"
        />
        <Row
          to="/more/profile"
          icon={<UserCircle size={22} aria-hidden />}
          title="Обо мне"
          meta="Имя, дата рождения, телефон; уход из дома"
        />
        <Row
          to="/more/settings"
          icon={<GearSix size={22} aria-hidden />}
          title="Настройки"
          meta="Пароль, второй фактор, устройства, установка"
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
      <p className="muted more-note">Покупок в приложении пока нет: раздел не готов.</p>
    </Page>
  );
}
