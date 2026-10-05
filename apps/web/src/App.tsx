import { AUDIENCE_LABELS, AUDIENCES } from '@homecrm/shared';

// Заглушка до R0.3: каркас PWA, навигация и переключатель пространств появятся там.
export function App() {
  return (
    <main className="placeholder">
      <h1>HomeCRM</h1>
      <p>Каркас приложения. Этап 0 — проверка рисков.</p>
      <p>
        Аудитории общего пространства:{' '}
        {AUDIENCES.map((audience) => AUDIENCE_LABELS[audience]).join(', ')}.
      </p>
    </main>
  );
}
