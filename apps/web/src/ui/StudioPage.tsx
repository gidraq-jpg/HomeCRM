import { CaretLeft } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router';
import { AddAction } from '../shell/AddAction.tsx';
import { FormHeading } from './FormHeading.tsx';
import { Page } from './Page.tsx';

/** Общая композиция списков, полных форм и служебных экранов; маршруты и содержимое остаются у экрана. */
export function StudioPage({
  children,
  back,
  title,
  eyebrow,
  formEyebrow,
  status,
  heading,
  className,
  form = false,
  service = false,
  backHistory = false,
  ...props
}: Parameters<typeof Page>[0] & {
  form?: boolean;
  formEyebrow?: string;
  service?: boolean;
  backHistory?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <Page
      {...props}
      title={title}
      className={`studio-list-page ui6-page ${form ? 'ui6-form-page ui7-fullscreen-form' : ''} ${service ? 'ui6-service-page' : ''} ${className ?? ''}`}
      heading={
        heading ??
        (form ? (
          <FormHeading
            title={title}
            back={back}
            backHistory={backHistory}
            eyebrow={formEyebrow}
            status={status}
          />
        ) : (
          <div className="studio-list-hero">
            {backHistory ? (
              <button className="back-link" type="button" onClick={() => void navigate(-1)}>
                <CaretLeft size={20} aria-hidden />
                {back?.label ?? 'Назад'}
              </button>
            ) : back || service ? (
              <Link className="back-link" to={back?.to ?? '/more'}>
                <CaretLeft size={20} aria-hidden />
                {back?.label ?? 'Назад'}
              </Link>
            ) : null}
            <div className="page-heading__line">
              <h1>{title}</h1>
              {status}
              {!form && !service ? <AddAction /> : null}
            </div>
            {eyebrow ? <p className="studio-list-count">{eyebrow}</p> : null}
          </div>
        ))
      }
    >
      <div className="studio-panel studio-list-panel ui6-panel">{children}</div>
    </Page>
  );
}
