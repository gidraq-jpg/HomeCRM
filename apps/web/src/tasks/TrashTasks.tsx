import { Link } from '../shell/motion.tsx';
import { Section } from '../ui/Page.tsx';
import { uniqueTasks, useTaskList } from './queries.ts';
import { taskPath } from './TaskRows.tsx';
import { LoadMore, QueryNotice } from './TasksScreen.tsx';
export function TrashTasks() {
  const query = useTaskList({}, true);
  return (
    <Section title="Дела">
      <QueryNotice query={query} />
      <ul className="row-list">
        {uniqueTasks(query.data?.pages.flat() ?? []).map((card) => (
          <li key={card.id}>
            <Link className="row" to={taskPath(card.id)}>
              <span className="row__title">{card.title}</span>
              <span className="row__meta">
                {card.seriesId
                  ? 'Дело серии · открыть для восстановления'
                  : 'Открыть для восстановления'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore query={query} label="Ещё удалённые дела" />
    </Section>
  );
}
