import {
  Buildings,
  FileText,
  ListChecks,
  Note,
  ShoppingCart,
  UserPlus,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { QuickAddSheet } from '../tasks/QuickAddSheet.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';

interface AddMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Панель «+»: только то, что уже можно создать. Сейчас это заметка, объект и документ — каждому — и
 * приглашение участника — администратору. Остальные разделы честно названы неготовыми.
 */
export function AddMenu({ open, onOpenChange }: AddMenuProps) {
  const { isAdmin } = useHousehold();
  const navigate = useNavigate();
  const [quick, setQuick] = useState(false);

  function go(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  if (quick && open)
    return (
      <QuickAddSheet
        open
        onOpenChange={(next) => {
          setQuick(next);
          if (!next) onOpenChange(false);
        }}
      />
    );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Добавить"
      description="Что можно добавить сейчас"
    >
      <RowList label="Что можно добавить">
        <Row
          icon={<ShoppingCart size={22} aria-hidden />}
          title="Покупка"
          meta="Одна строка, количество, заметка и связи"
          onClick={() => go('/more/shopping')}
        />
        <Row
          icon={<ListChecks size={22} aria-hidden />}
          title="Дело"
          meta="Одной строкой: дата, время, исполнитель и объект"
          onClick={() => setQuick(true)}
        />
        <Row
          icon={<ListChecks size={22} aria-hidden />}
          title="Новое дело"
          meta="Полная форма: план, чек-лист, ожидание и повтор"
          onClick={() => go('/today/new')}
        />
        <Row
          icon={<Note size={22} aria-hidden />}
          title="Заметка"
          meta="Текст, чек-лист; по умолчанию личная"
          onClick={() => go('/more/notes/new')}
        />
        <Row
          icon={<Buildings size={22} aria-hidden />}
          title="Объект"
          meta="Квартира, дача, машина, техника; недвижимость — для взрослых"
          onClick={() => go('/home/new')}
        />
        <Row
          icon={<FileText size={22} aria-hidden />}
          title="Документ"
          meta="Паспорт, полис, договор: серия и номер, срок, страницы-сканы"
          onClick={() => go('/documents/new')}
        />
        <Row
          icon={<ListChecks size={22} aria-hidden />}
          title="Из шаблона"
          meta="Новая квартира или дом: счета, счётчики и сроки сразу"
          onClick={() => go('/home/from-template')}
        />
        {isAdmin ? (
          <Row
            icon={<UserPlus size={22} aria-hidden />}
            title="Участник дома"
            meta="Ссылка-приглашение для взрослого, ребёнка или администратора"
            onClick={() => go('/people/invite')}
          />
        ) : null}
      </RowList>
      <p className="muted add-note">
        Дело можно добавить и быстрой строкой на «Сегодня».
        {isAdmin
          ? ''
          : ' Сейчас можно записать заметку, завести объект или документ, заполнить «Обо мне» и посмотреть, кто в доме.'}
      </p>
    </Sheet>
  );
}
