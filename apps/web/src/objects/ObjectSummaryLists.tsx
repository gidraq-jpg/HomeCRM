import { Drop, FileText, Lightning, Plus } from '@phosphor-icons/react';
import { DocumentRows } from '../documents/DocumentsScreen.tsx';
import { useObjectDocuments } from '../documents/queries.ts';
import { readingText } from '../meters/ObjectMeters.tsx';
import { useMeters } from '../meters/queries.ts';
import { Link } from '../shell/motion.tsx';
import { formatDateOnly } from '../tasks/fields.tsx';
import { uniqueTasks, useTaskList } from '../tasks/queries.ts';
import { TaskRows } from '../tasks/TaskRows.tsx';
import { LoadMore, QueryNotice } from '../tasks/TasksScreen.tsx';
import { Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import type { ObjectCard } from './api.ts';
import { useObjectContext } from './context.ts';

/** Краткий обзор существующих записей; правка остаётся на их штатных экранах. */
export function ObjectSummaryLists({ card }: { card: ObjectCard }) {
  const property = card.objectType === 'property';
  const { abilities } = useObjectContext();
  const meters = useMeters(card.id, 'active', property);
  const base = `/home/${card.id}`;
  const documents = useObjectDocuments(card.id);
  const tasks = useTaskList({ objectId: card.id });
  return (
    <>
      {property ? (
        <Section
          title="Счётчики"
          aside={
            <Link className="text-button" to={`${base}/readings`}>
              Передать показания
            </Link>
          }
        >
          {meters.isPending ? (
            <p className="muted">Загружаем счётчики…</p>
          ) : meters.error ? (
            <button type="button" className="text-button" onClick={() => void meters.refetch()}>
              Повторить загрузку счётчиков
            </button>
          ) : meters.data?.length ? (
            <RowList label="Счётчики объекта">
              {meters.data.map((meter) => (
                <Row
                  key={meter.id}
                  to={`${base}/meters`}
                  title={meter.title}
                  icon={
                    meter.data.resource === 'electricity' ? (
                      <Lightning size={20} aria-hidden />
                    ) : (
                      <Drop size={20} aria-hidden />
                    )
                  }
                  iconTone={meter.data.resource === 'electricity' ? 'electricity' : 'water'}
                  meta={
                    meter.previousReading
                      ? `${readingText(meter)} · ${formatDateOnly(meter.previousReading.occurredOn)}`
                      : 'Показаний пока нет'
                  }
                />
              ))}
            </RowList>
          ) : (
            <p className="muted studio-empty">Счётчиков пока нет</p>
          )}
          <Link className="text-button" to={`${base}/meters`}>
            Все счётчики
          </Link>
        </Section>
      ) : null}
      <Section
        title="Документы"
        aside={
          <Link className="icon-button" to="/documents/new" aria-label="Добавить документ">
            <Plus size={20} aria-hidden />
          </Link>
        }
      >
        {documents.isPending ? (
          <p className="muted">Загружаем документы…</p>
        ) : documents.error ? (
          <button type="button" className="text-button" onClick={() => void documents.refetch()}>
            Повторить загрузку документов
          </button>
        ) : documents.data?.length ? (
          <DocumentRows documents={documents.data} label="Документы объекта" />
        ) : (
          <p className="muted studio-empty">Документов пока нет</p>
        )}
      </Section>
      <Section
        title="Дела"
        aside={
          <Link
            className="icon-button"
            to={`/today/new?objectId=${card.id}`}
            aria-label="Добавить дело к объекту"
          >
            <Plus size={20} aria-hidden />
          </Link>
        }
      >
        {tasks.error ? <QueryNotice query={tasks} /> : null}
        {/* Загрузка и пустой ответ занимают одинаковую строку: факты ниже не прыгают. */}
        {tasks.isPending ? (
          <p className="muted studio-empty">Загружаем дела…</p>
        ) : tasks.data?.pages.some((page) => page.length > 0) ? (
          <TaskRows tasks={uniqueTasks(tasks.data.pages.flat())} label="Дела объекта" />
        ) : tasks.data ? (
          <p className="muted studio-empty">Дел пока нет</p>
        ) : null}
        <LoadMore query={tasks} label="Показать ещё дела объекта" />
      </Section>
      <Section
        title="Файлы"
        aside={
          abilities.edit ? (
            <Link className="icon-button" to={`${base}/files`} aria-label="Добавить файл к объекту">
              <Plus size={20} aria-hidden />
            </Link>
          ) : null
        }
      >
        {card.files.length ? (
          <RowList label="Файлы объекта">
            {card.files.map((file) => (
              <Row
                key={file.id}
                to={`${base}/files`}
                title={file.name}
                icon={<FileText size={20} aria-hidden />}
              />
            ))}
          </RowList>
        ) : (
          <p className="muted studio-empty">Файлов пока нет</p>
        )}
      </Section>
    </>
  );
}
