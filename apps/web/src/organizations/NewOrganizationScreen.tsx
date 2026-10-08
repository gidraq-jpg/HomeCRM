import { useNavigate } from 'react-router';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { CreateOrganization } from './CreateOrganization.tsx';

const BACK = { to: '/more/organizations', label: 'Организации' } as const;

/** Создание организации: «Ещё → Организации → Добавить». Название обязательно, остальное нет. */
export function NewOrganizationScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Page title="Новая организация" back={BACK}>
      <CreateOrganization
        onCancel={() => navigate('/more/organizations')}
        onCreated={(card) => {
          toast.show({ message: 'Организация сохранена' });
          navigate(`/more/organizations/${card.id}`, { replace: true });
        }}
      />
    </Page>
  );
}
