import { CaretLeft } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router';

/** Компактная шапка формы; прежний адрес возврата или переход по истории сохраняется. */
export function FormHeading({
  title,
  back,
  backHistory = false,
}: {
  title: string;
  back?: { to: string; label: string };
  backHistory?: boolean;
}) {
  const navigate = useNavigate();
  const content = (
    <>
      <CaretLeft size={20} aria-hidden />
      Назад
    </>
  );
  return (
    <div className="ui7-form-heading">
      {backHistory ? (
        <button type="button" className="back-link" onClick={() => void navigate(-1)}>
          {content}
        </button>
      ) : back ? (
        <Link className="back-link" to={back.to}>
          {content}
        </Link>
      ) : null}
      <h1>{title}</h1>
    </div>
  );
}
