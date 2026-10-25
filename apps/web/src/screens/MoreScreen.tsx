import {
  AddressBook,
  BellRinging,
  CalendarCheck,
  CloudArrowUp,
  Export,
  Gauge,
  GearSix,
  House,
  Lock,
  Note,
  ShoppingCart,
  Trash,
  UserCircle,
} from '@phosphor-icons/react';
import { InboxLink } from '../inbox/InboxScreen.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { StudioPage as Page } from '../ui/StudioPage.tsx';

/** «Ещё»: то, что в приложении уже работает. Покупки — позже. */
export function MoreScreen() {
  return (
    <Page service title="Ещё" eyebrow="Под рукой" back={{ to: '/today', label: 'Сегодня' }}>
      <InboxLink />
      <RowList label="Разделы">
        <Row
          to="/more/shopping"
          icon={<ShoppingCart size={22} aria-hidden />}
          title="Покупки"
          meta="Общий и личный списки, количество и заметки"
        />
        <Row
          to="/more/offline"
          icon={<CloudArrowUp size={22} aria-hidden />}
          title="Очередь изменений"
          meta="Сохранённое на устройстве и конфликты"
        />
        <Row
          to="/more/notes"
          icon={<Note size={22} aria-hidden />}
          title="Заметки"
          meta="Личные и общие, с чек-листом"
        />
        <Row
          to="/more/readings"
          icon={<Gauge size={22} aria-hidden />}
          title="Показания"
          meta="Счётчики по квартире: ввод и передача поставщику"
        />
        <Row
          to="/more/organizations"
          icon={<AddressBook size={22} aria-hidden />}
          title="Организации"
          meta="УК, поставщики, аварийные службы: телефоны под рукой"
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
          title="Мои данные"
          meta="Скачать личное и общее в ZIP"
        />
        <Row
          to="/more/spaces"
          icon={<Lock size={22} aria-hidden />}
          title="Как устроены личное и общее"
          meta="Кто что видит"
        />
      </RowList>
    </Page>
  );
}
