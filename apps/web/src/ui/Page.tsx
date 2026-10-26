import { CaretLeft } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import { AddAction } from '../shell/AddAction.tsx';
import { Link } from '../shell/motion.tsx';
import { isStudio } from '../shell/studio.ts';

/** Название вкладки браузера и читалок экрана меняется вместе с экраном. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — HomeCRM`;
  }, [title]);
}

interface PageProps {
  title: string;
  /** Локальная композиция экрана; по умолчанию сохраняется общий каркас. */
  className?: string;
  /** Свой заголовочный блок обязан сохранить доступный h1. */
  heading?: ReactNode;
  /** Строка над заголовком: дата, адрес объекта. */
  eyebrow?: string;
  back?: { to: string; label: string };
  /** Вкладки раздела под заголовком. */
  tabs?: ReactNode;
  /**
   * Название вкладки браузера, если оно должно отличаться от заголовка. Заметка так прячет
   * свой заголовок: он не попадает в историю браузера.
   */
  documentTitle?: string;
  /** Статус рядом с названием (недвижимость: «Живём», «Сдаётся»). Заголовок h1 остаётся чистым. */
  status?: ReactNode;
  children: ReactNode;
}

export function Page({
  title,
  eyebrow,
  back,
  tabs,
  documentTitle,
  status,
  children,
  className,
  heading,
}: PageProps) {
  usePageTitle(documentTitle ?? title);
  return (
    <div className={className ? `page ${className}` : 'page'}>
      {back ? (
        <Link className="back-link" to={back.to}>
          <CaretLeft size={20} aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="page-heading">
        {heading ?? (
          <>
            {eyebrow ? <p className="page-heading__eyebrow">{eyebrow}</p> : null}
            <div className="page-heading__line">
              <h1>{title}</h1>
              {status}
              {isStudio() ? <AddAction /> : null}
            </div>
          </>
        )}
      </div>
      {tabs}
      {children}
    </div>
  );
}

interface SectionProps {
  motionKey?: string;
  title: string;
  level?: 2 | 3 | 4;
  /** Рядом с заголовком: счётчик или ссылка. */
  aside?: ReactNode;
  /** Тот же стиль, что у «Главное на сегодня» в LifeOS. */
  eyebrow?: boolean;
  children: ReactNode;
}

export function Section({
  title,
  aside,
  eyebrow = false,
  children,
  level = 2,
  motionKey,
}: SectionProps) {
  const Heading = `h${level}` as const;
  return (
    <section className="section" data-motion-key={motionKey}>
      <div className="section__head">
        <Heading className={eyebrow ? 'section__title section__title--eyebrow' : 'section__title'}>
          {title}
        </Heading>
        {aside}
      </div>
      {children}
    </section>
  );
}
