import { CaretLeft, DotsThree, PencilSimple } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import type { Visibility } from '../access/visibility.ts';
import { Page } from './Page.tsx';
import { Sheet } from './Sheet.tsx';

interface RecordPageProps {
  title: string;
  documentTitle: string;
  type: string;
  subtitle?: ReactNode;
  back: { to: string; label: string };
  visibility: Visibility;
  facts?: readonly { label: string; value: ReactNode }[];
  onEdit?: () => void;
  editLabel?: string;
  editPending?: boolean;
  more: ReactNode;
  editing?: boolean;
  access?: ReactNode;
  onAccess?: () => void;
  children: ReactNode;
}

/** Шапка по карточке объекта; операции и существующие подтверждения передаются самим экраном. */
export function RecordPage({
  title,
  documentTitle,
  type,
  subtitle,
  back,
  visibility,
  facts = [],
  onEdit,
  editLabel = 'Править',
  editPending = false,
  editing = false,
  more,
  access,
  onAccess,
  children,
}: RecordPageProps) {
  const [panel, setPanel] = useState<'more' | 'access' | null>(null);
  const badge = <AccessBadge visibility={visibility} showLabel />;
  return (
    <Page
      title={title}
      documentTitle={documentTitle}
      className="ui6-record-page"
      heading={
        <div className="object-hero">
          <div className="object-hero__actions">
            <Link className="back-link" to={back.to}>
              <CaretLeft size={20} aria-hidden />
              {back.label}
            </Link>
            {onEdit ? (
              <button
                className="icon-button"
                type="button"
                aria-label={editLabel}
                disabled={editPending}
                aria-busy={editPending}
                onClick={() => {
                  setPanel(null);
                  onEdit();
                }}
              >
                <PencilSimple size={22} aria-hidden />
              </button>
            ) : null}
            <button
              className="icon-button"
              type="button"
              aria-label="Ещё: действия с записью"
              disabled={editing}
              onClick={() => setPanel('more')}
            >
              <DotsThree size={24} aria-hidden />
            </button>
          </div>
          <p className="object-hero__type">{type}</p>
          <h1>{title}</h1>
          <div className="object-hero__meta">
            {subtitle ? <span>{subtitle}</span> : null}
            {access || onAccess ? (
              <button
                className="object-access-trigger"
                type="button"
                aria-label="Кто видит запись"
                disabled={editing}
                onClick={() => {
                  if (onAccess) onAccess();
                  else setPanel('access');
                }}
              >
                {badge}
              </button>
            ) : (
              badge
            )}
          </div>
          {facts.length ? (
            <dl className="object-facts">
              {facts.slice(0, 3).map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      }
    >
      <div className="studio-panel studio-list-panel ui6-panel ui6-record-panel">{children}</div>
      <Sheet
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        title={panel === 'access' ? 'Кто видит' : 'Ещё'}
        description={panel === 'access' ? 'Доступ к записи' : 'Действия с записью'}
      >
        <div className="ui6-actions">
          {panel === 'more' ? more : null}
          {access}
        </div>
      </Sheet>
    </Page>
  );
}
