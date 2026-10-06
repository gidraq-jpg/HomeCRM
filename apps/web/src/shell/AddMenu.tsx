import { UserPlus } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';

interface AddMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Панель «+»: только то, что уже можно создать. Сейчас это приглашение участника — для
 * администратора. Остальным панель честно говорит, что добавлять пока нечего.
 */
export function AddMenu({ open, onOpenChange }: AddMenuProps) {
  const { isAdmin } = useHousehold();
  const navigate = useNavigate();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Добавить"
      description={isAdmin ? 'Что можно добавить сейчас' : 'Пока добавлять нечего'}
    >
      {isAdmin ? (
        <RowList label="Что можно добавить">
          <Row
            icon={<UserPlus size={22} aria-hidden />}
            title="Участник дома"
            meta="Ссылка-приглашение для взрослого, ребёнка или администратора"
            onClick={() => {
              onOpenChange(false);
              navigate('/people/invite');
            }}
          />
        </RowList>
      ) : null}
      <p className="muted add-note">
        Дела, заметки, документы и объекты в приложении пока создавать нельзя: эти разделы не
        готовы.
        {isAdmin ? '' : ' Сейчас можно заполнить «Обо мне» и посмотреть, кто в доме.'}
      </p>{' '}
    </Sheet>
  );
}
