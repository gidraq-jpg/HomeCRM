import { CaretLeft } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router';

/** Название вкладки браузера и читалок экрана меняется вместе с экраном. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — HomeCRM`;
  }, [title]);
}

interface PageProps {
  title: string;
  /** Строка над заголовком: дата, адрес объекта. */
  eyebrow?: string;
  back?: { to: string; label: string };
  /** Вкладки раздела под заголовком. */
  tabs?: ReactNode;
  children: ReactNode;
}

export function Page({ title, eyebrow, back, tabs, children }: PageProps) {
  usePageTitle(title);
  return (
    <div className="page">
      {back ? (
        <Link className="back-link" to={back.to}>
          <CaretLeft size={20} aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="page-heading">
        {eyebrow ? <p className="page-heading__eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </div>
      {tabs}
      {children}
    </div>
  );
}

interface SectionProps {
  title: string;
  /** Рядом с заголовком: счётчик или ссылка. */
  aside?: ReactNode;
  /** Тот же стиль, что у «Главное на сегодня» в LifeOS. */
  eyebrow?: boolean;
  children: ReactNode;
}

export function Section({ title, aside, eyebrow = false, children }: SectionProps) {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className={eyebrow ? 'section__title section__title--eyebrow' : 'section__title'}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
