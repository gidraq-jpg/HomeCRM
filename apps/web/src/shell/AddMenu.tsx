import { Note, UserPlus } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';

interface AddMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Панель «+»: только то, что уже можно создать. Сейчас это заметка — каждому — и приглашение
 * участника — администратору. Остальные разделы честно названы неготовыми.
 */
export function AddMenu({ open, onOpenChange }: AddMenuProps) {
  const { isAdmin } = useHousehold();
  const navigate = useNavigate();

  function go(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Добавить"
      description="Что можно добавить сейчас"
    >
      <RowList label="Что можно добавить">
        <Row
          icon={<Note size={22} aria-hidden />}
          title="Заметка"
          meta="Текст, чек-лист; по умолчанию личная"
          onClick={() => go('/more/notes/new')}
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
        Дела, документы и объекты в приложении пока создавать нельзя: эти разделы не готовы.
        {isAdmin
          ? ''
          : ' Сейчас можно записать заметку, заполнить «Обо мне» и посмотреть, кто в доме.'}
      </p>
    </Sheet>
  );
}
