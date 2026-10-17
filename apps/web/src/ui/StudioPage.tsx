import { CaretLeft } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { Page } from './Page.tsx';

/** Общая композиция списков, полных форм и служебных экранов; маршруты и содержимое остаются у экрана. */
export function StudioPage({
  children,
  back,
  title,
  eyebrow,
  status,
  heading,
  className,
  form = false,
  service = false,
  ...props
}: Parameters<typeof Page>[0] & { form?: boolean; service?: boolean }) {
  return (
    <Page
      {...props}
      title={title}
      className={`studio-list-page ui6-page ${form ? 'ui6-form-page' : ''} ${service ? 'ui6-service-page' : ''} ${className ?? ''}`}
      heading={
        heading ?? (
          <div className="studio-list-hero">
            {back || service ? (
              <Link className="back-link" to={back?.to ?? '/more'}>
                <CaretLeft size={20} aria-hidden />
                {back?.label ?? 'Назад'}
              </Link>
            ) : null}
            <div className="page-heading__line">
              <h1>{title}</h1>
              {status}
              {!form ? <AddAction /> : null}
            </div>
            {eyebrow ? <p className="studio-list-count">{eyebrow}</p> : null}
          </div>
        )
      }
    >
      <div className="studio-panel studio-list-panel ui6-panel">{children}</div>
    </Page>
  );
}
