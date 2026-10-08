import { HouseLine, Key, Tree } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Notice } from '../auth/components.tsx';
import { Page } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { Template } from './api.ts';
import { useRefreshAfterTemplate, useTemplates } from './queries.ts';
import { TemplateForm } from './TemplateForm.tsx';

const BACK = { to: '/home', label: 'Дом' } as const;

/** Значок и пояснение к шаблону MVP (приложение А PRD). */
export const TEMPLATE_ICONS: Readonly<Record<string, ReactNode>> = {
  apartment: <HouseLine size={22} aria-hidden />,
  rented_apartment: <Key size={22} aria-hidden />,
  house: <Tree size={22} aria-hidden />,
};
export const TEMPLATE_HINTS: Readonly<Record<string, string>> = {
  apartment: 'Счета, счётчики, организации и сроки типовой квартиры',
  rented_apartment: 'То же и кто платит, показания арендатора, налоговые сроки',
  house: 'Электричество, газ, вода, вывоз мусора, налоги',
};

/** Выбор шаблона строками: ссылка ведёт на форму выбранного шаблона. */
export function TemplateRows({
  templates,
  hrefOf,
}: {
  templates: readonly Template[];
  hrefOf: (template: Template) => string;
}) {
  return (
    <RowList label="Шаблоны">
      {templates.map((template) => (
        <Row
          key={template.id}
          to={hrefOf(template)}
          icon={TEMPLATE_ICONS[template.id]}
          title={template.title}
          meta={TEMPLATE_HINTS[template.id]}
        />
      ))}
    </RowList>
  );
}

/**
 * Новый объект из шаблона («+» → «Объект из шаблона» и пустой «Дом», TPL-2…4): сначала выбор
 * шаблона, затем список пунктов с галочками и «Кто видит». После создания открывается карточка.
 */
export function NewFromTemplateScreen() {
  const { templateId } = useParams();
  const query = useTemplates();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshAfterTemplate();

  if (query.isPending) {
    return (
      <Page title="Объект из шаблона" back={BACK}>
        <Notice>Загружаем шаблоны…</Notice>
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page title="Объект из шаблона" back={BACK}>
        <Notice error>Не удалось загрузить шаблоны. Проверьте подключение и повторите.</Notice>
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку шаблонов
        </button>
      </Page>
    );
  }

  const template =
    templateId === undefined ? undefined : query.data.find((item) => item.id === templateId);
  if (templateId === undefined) {
    return (
      <Page title="Объект из шаблона" back={BACK}>
        <p className="muted">
          Шаблон заведёт объект сразу со счетами, счётчиками и сроками. Лишнее снимается галочками
          на следующем шаге.
        </p>
        <TemplateRows templates={query.data} hrefOf={(item) => `/home/from-template/${item.id}`} />
        <Link className="text-button list-action" to="/home/new">
          Создать пустой объект без шаблона
        </Link>
      </Page>
    );
  }
  if (template === undefined) {
    return (
      <Page title="Объект из шаблона" back={{ to: '/home/from-template', label: 'Шаблоны' }}>
        <Notice error>Такого шаблона нет. Выберите шаблон из списка.</Notice>
      </Page>
    );
  }

  return (
    <Page
      title="Новый объект"
      eyebrow={template.title}
      back={{ to: '/home/from-template', label: 'Шаблоны' }}
    >
      <TemplateForm
        template={template}
        onCreated={async (objectId) => {
          await refresh();
          toast.show({ message: 'Объект создан из шаблона' });
          navigate(`/home/${objectId}`, { replace: true });
        }}
      />
    </Page>
  );
}
