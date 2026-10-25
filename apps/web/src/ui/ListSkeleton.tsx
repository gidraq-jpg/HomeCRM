/** Загрузка не изображает пустые данные и не объявляет вымышленные значения. */
export function ListSkeleton({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div className="list-skeleton" role="status" aria-label={label}>
      {[0, 1, 2].map((id) => (
        <div className="list-skeleton__row" key={id} aria-hidden>
          <span className="list-skeleton__icon" />
          <span className="list-skeleton__text">
            <span />
            <span />
          </span>
        </div>
      ))}
    </div>
  );
}
