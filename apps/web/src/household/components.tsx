import { Copy } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice } from '../auth/components.tsx';
import { previewUrl } from '../files/api.ts';
import { copyText } from '../ui/CopyButton.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  type HouseholdAction,
  householdErrorMessage,
  isSecondFactorRequired,
  SECOND_FACTOR_TEXT,
} from './errors.ts';

/** Фото профиля или, пока его нет, первая буква имени. */
export function Avatar({
  name,
  large = false,
  photoFileId = null,
}: {
  name: string;
  large?: boolean;
  /** Если файла не видно или он не открылся, остаётся буква имени. */
  photoFileId?: string | null;
}) {
  const [brokenFor, setBrokenFor] = useState<string | null>(null);
  return (
    <span className={large ? 'avatar avatar--large' : 'avatar'} aria-hidden>
      {photoFileId !== null && brokenFor !== photoFileId ? (
        <img
          className="avatar__photo"
          src={previewUrl(photoFileId)}
          alt=""
          onError={() => setBrokenFor(photoFileId)}
        />
      ) : (
        name.trim().slice(0, 1).toUpperCase() || '?'
      )}
    </span>
  );
}

/** Ошибка действия. Для второго фактора — объяснение со ссылкой на настройки, а не «ошибка». */
export function ActionError({ error, action }: { error: unknown; action: HouseholdAction }) {
  if (!error) return null;
  if (isSecondFactorRequired(error)) {
    return (
      <Notice>
        <strong>Нужен второй фактор</strong>
        <p>{SECOND_FACTOR_TEXT}</p>
        <Link className="text-button" to="/more/settings">
          Открыть «Настройки»
        </Link>
      </Notice>
    );
  }
  return <Notice error>{householdErrorMessage(error, action)}</Notice>;
}

interface IssuedLinkBoxProps {
  url: string;
  /** Что за ссылка: «ссылка-приглашение», «ссылка для сброса пароля». */
  what: string;
}

/**
 * Выданная ссылка. Сервер показывает её один раз и больше не хранит открытым текстом:
 * её видно только на этом экране, а потерянную нужно выдать заново.
 */
export function IssuedLinkBox({ url, what }: IssuedLinkBoxProps) {
  const toast = useToast();
  return (
    <div className="issued-link">
      <p className="issued-link__text auth-secret" data-testid="issued-link">
        {url}
      </p>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={async () => {
          const copied = await copyText(url);
          toast.show({
            message: copied ? `Скопировано: ${what}` : 'Не удалось скопировать',
            ...(copied ? {} : { detail: 'Выделите ссылку и скопируйте её вручную.' }),
          });
        }}
      >
        <Copy size={20} aria-hidden />
        Скопировать
      </button>
    </div>
  );
}
