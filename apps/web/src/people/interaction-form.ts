import { kopecksToInput, parseRubles } from '../objects/money.ts';
import {
  type Interaction,
  type InteractionInput,
  type InteractionKind,
  MAX_INTERACTION_TEXT,
} from './api.ts';

// Форма взаимодействия (CONT-4): вид, дата, текст, сумма, «звать снова», объект. Сумма вводится в
// рублях с запятой или точкой и уходит в API целыми копейками, без чисел с плавающей точкой.

export type CallAgainChoice = 'unset' | 'yes' | 'no';

export interface InteractionDraft {
  kind: InteractionKind;
  occurredOn: string;
  text: string;
  /** Сумма в рублях, как её вводят. */
  amount: string;
  callAgain: CallAgainChoice;
  objectId: string;
}

export function emptyInteractionDraft(today: string): InteractionDraft {
  return {
    kind: 'call',
    occurredOn: today,
    text: '',
    amount: '',
    callAgain: 'unset',
    objectId: '',
  };
}

export function interactionDraft(item: Interaction): InteractionDraft {
  return {
    kind: item.kind,
    occurredOn: item.occurredOn,
    text: item.text,
    amount: item.amountCents === null ? '' : kopecksToInput(item.amountCents),
    callAgain: item.callAgain === null ? 'unset' : item.callAgain ? 'yes' : 'no',
    objectId: item.objectId ?? '',
  };
}

export interface InteractionErrors {
  occurredOn?: string;
  text?: string;
  amount?: string;
}

export type InteractionResult =
  | { ok: true; value: InteractionInput }
  | { ok: false; errors: InteractionErrors };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toInteractionInput(draft: InteractionDraft): InteractionResult {
  const errors: InteractionErrors = {};
  if (!DATE.test(draft.occurredOn)) errors.occurredOn = 'Укажите дату полностью.';
  const text = draft.text.trim();
  if (text === '') errors.text = 'Опишите, что было: без текста запись не сохранить.';
  else if (text.length > MAX_INTERACTION_TEXT)
    errors.text = `Текст длиннее ${MAX_INTERACTION_TEXT} знаков.`;
  const amount = parseRubles(draft.amount);
  if (!amount.ok || (amount.kopecks !== null && amount.kopecks < 0)) {
    errors.amount = 'Введите сумму числом: 3500 или 1 840,50. Не больше двух знаков после запятой.';
  }
  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: draft.kind,
      occurredOn: draft.occurredOn,
      text,
      amountCents: amount.kopecks,
      callAgain: draft.callAgain === 'unset' ? null : draft.callAgain === 'yes',
      objectId: draft.objectId === '' ? null : draft.objectId,
    },
  };
}
