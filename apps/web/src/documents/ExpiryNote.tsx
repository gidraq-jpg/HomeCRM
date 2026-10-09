import { Link } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import type { DocumentCard } from './api.ts';
import { dateLabel, type ExpirySource } from './labels.ts';

/** Подсказка владельцу, откуда взят срок паспорта РФ и что сделать, если даты рождения нет (DOC-4). */
export function ExpiryNote({ card, source }: { card: DocumentCard; source: ExpirySource }) {
  const { me } = useHousehold();
  if (source.kind === 'age') {
    return (
      <div className="expiry-note" role="note">
        <p className="expiry-note__title">
          Срок по возрасту: до {dateLabel(source.until)}
          {source.years === null ? '' : ` — ${source.years} лет`}
        </p>
        <p>
          Вычислен по дате рождения владельца: паспорт РФ меняют в 20 и 45 лет, на замену даётся 90
          дней. Замена с {dateLabel(source.start)}; предупреждения придут до дня рождения. Явный
          срок в «Править» важнее вычисленного.
        </p>
      </div>
    );
  }
  if (source.kind !== 'pending') return null;

  const { owner } = card;
  return (
    <div className="expiry-note" role="note">
      <p className="expiry-note__title">Срок пока не вычислен</p>
      <p>
        Укажите дату рождения владельца: тогда срок паспорта появится сам.{' '}
        {owner?.kind === 'member' ? (
          owner.id === me.id ? (
            <Link to="/more/profile">Открыть мой профиль</Link>
          ) : (
            'Дату рождения вносит сам участник в своём профиле.'
          )
        ) : owner?.kind === 'contact' ? (
          <Link to={`/people/contacts/${owner.id}`}>Открыть контакт</Link>
        ) : (
          'У документа нет владельца с датой рождения.'
        )}
      </p>
      <p>Можно и не ждать: срок действия вводится вручную в «Править».</p>
    </div>
  );
}
