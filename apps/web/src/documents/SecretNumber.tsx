import { Copy, Eye, EyeSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { copyText } from '../ui/CopyButton.tsx';
import { useToast } from '../ui/Toast.tsx';
import { MASKED_NUMBER } from './labels.ts';

/**
 * Серия и номер документа (DOC-2, DOC-6): на экране скрыты, пока не нажато «Показать»; копируются
 * одним касанием. Значение не попадает ни в сообщение о копировании, ни в адрес, ни в хранилища.
 * Скрывается снова, когда страница уходит в фон или открывается другой документ.
 */
export function SecretNumber({ value }: { value: string }) {
  const toast = useToast();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) setShown(false);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  if (value === '') return <span className="muted">Не указаны</span>;

  return (
    <span className="secret">
      {shown ? (
        <span className="secret__value">{value}</span>
      ) : (
        <>
          <span className="secret__value" aria-hidden="true">
            {MASKED_NUMBER}
          </span>
          <span className="visually-hidden">Скрыты</span>
        </>
      )}
      <button
        type="button"
        className="btn btn--secondary secret__toggle"
        aria-pressed={shown}
        onClick={() => setShown((previous) => !previous)}
      >
        {shown ? <EyeSlash size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
        {shown ? 'Скрыть' : 'Показать'}
      </button>
      <button
        type="button"
        className="icon-button icon-button--soft"
        aria-label="Скопировать серию и номер"
        onClick={async () => {
          const copied = await copyText(value);
          toast.show({
            message: copied ? 'Серия и номер скопированы' : 'Не удалось скопировать',
            ...(copied ? {} : { detail: 'Нажмите «Показать» и скопируйте вручную.' }),
          });
        }}
      >
        <Copy size={22} aria-hidden />
      </button>
    </span>
  );
}
