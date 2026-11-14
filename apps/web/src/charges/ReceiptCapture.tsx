import {
  matchReceiptAccount,
  type ReceiptAccount,
  ReceiptAccounts,
  ReceiptPhotoDraft,
} from '@homecrm/shared';
import { useRef, useState } from 'react';
import { aiError, useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { IdentityConfirmation } from '../ai/IdentityConfirmation.tsx';
import { ApiError, apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { readReceiptQr } from './qr.ts';

export function ReceiptCapture({
  onDraft,
  onManual,
  disabled = false,
  onPending,
}: {
  onDraft: (draft: ReceiptPhotoDraft, file: File, accounts: ReceiptAccount[]) => void;
  onManual: (file: File) => void;
  disabled?: boolean;
  onPending?: (pending: boolean) => void;
}) {
  const { householdId } = useHousehold();
  const status = useAiStatus(householdId);
  const consent = useAiConsent(householdId, status.data?.provider);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [confirmation, setConfirmation] = useState<{
    file: File;
    accounts: ReceiptAccount[];
    house: string;
  }>();
  const question = confirmation?.house === householdId ? confirmation : undefined;
  function progress(value: boolean) {
    setPending(value);
    onPending?.(value);
  }
  async function ai(file: File, accounts: ReceiptAccount[], identityConfirmed = false) {
    if (!householdId || busy.current) return;
    busy.current = true;
    progress(true);
    setConfirmation(undefined);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(
        `/api/ai/receipt-photo?spaceId=${householdId}&consent=true${identityConfirmed ? '&identityConfirmed=true' : ''}`,
        {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
          cache: 'no-store',
        },
      );
      const json = await response.json();
      if (!response.ok)
        throw new ApiError(response.status, typeof json?.code === 'string' ? json.code : '');
      const draft = ReceiptPhotoDraft.parse(json);
      onDraft(draft, file, accounts);
      setSource('Черновик ИИ — проверьте поля.');
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 422 &&
        failure.code === 'AI_PRIVATE_DOCUMENT'
      ) {
        setConfirmation({ file, accounts, house: householdId });
      } else setError(aiError(failure));
    } finally {
      busy.current = false;
      progress(false);
    }
  }
  async function pick(file: File) {
    if (busy.current || disabled || !householdId) return;
    busy.current = true;
    progress(true);
    setError('');
    setSource('');
    let fallback: (() => void) | undefined;
    try {
      if (file.size > 10 * 1024 * 1024) {
        setError('Фото должно быть не больше 10 МБ.');
        return;
      }
      let qr: Awaited<ReturnType<typeof readReceiptQr>> = null;
      try {
        qr = await readReceiptQr(file);
      } catch {
        /* Неподдержанный браузером формат проверит сервер. */
      }
      const accounts = await apiRequest(
        'GET',
        `ai/receipt-accounts?spaceId=${householdId}`,
        ReceiptAccounts,
      );
      if (qr) {
        const f = <T,>(value: T) => ({ value, confident: value !== null });
        const accountId = matchReceiptAccount(
          qr.accountNumber,
          accounts.map((account) => ({ id: account.id, number: account.data.number })),
        );
        onDraft(
          {
            supplier: f(qr.supplier),
            accountId: f(accountId),
            period: f(qr.period),
            totalCents: f(qr.totalCents),
            dueOn: f(null),
          },
          file,
          accounts,
        );
        setSource('QR прочитан на телефоне без ИИ. Проверьте счёт, сумму и период.');
      } else if (status.data?.enabled) fallback = () => consent.ask(() => void ai(file, accounts));
      else setError('QR не прочитан. ИИ выключен — заполните начисление вручную.');
    } catch {
      setError('Не удалось прочитать квитанцию. Поля формы сохранены; попробуйте другое фото.');
    } finally {
      busy.current = false;
      progress(false);
    }
    fallback?.();
  }
  return (
    <div className="field">
      <input
        ref={input}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Квитанция для заполнения"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void pick(file);
        }}
      />
      <button
        type="button"
        className="btn btn--secondary"
        disabled={pending || disabled || !!question}
        onClick={() => input.current?.click()}
      >
        {pending ? 'Читаем квитанцию…' : 'Заполнить по квитанции'}
      </button>
      {source ? <p role="status">{source}</p> : null}
      {error ? <Notice error>{error}</Notice> : null}
      {question ? (
        <IdentityConfirmation
          disabled={disabled}
          onRecognize={() => void ai(question.file, question.accounts, true)}
          onManual={() => {
            setConfirmation(undefined);
            onManual(question.file);
          }}
        />
      ) : null}
      {consent.dialog}
    </div>
  );
}
