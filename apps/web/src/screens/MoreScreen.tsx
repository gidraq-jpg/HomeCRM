import { Export, GearSix, Lock, UserCircle } from '@phosphor-icons/react';
import { Page } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';

/** «Ещё»: то, что в приложении уже работает. Заметки, покупки, радар и корзина — позже. */
export function MoreScreen() {
  return (
    <Page title="Ещё" eyebrow="Под рукой">
      <RowList label="Разделы">
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
      <p className="muted more-note">
        Заметок, покупок, радара и корзины в приложении пока нет: эти разделы не готовы.
      </p>
    </Page>
  );
}
