import type { ReactNode } from 'react';

/** Кнопка остаётся в прежней форме/fieldset: submit, pending и disabled не меняются. */
export function FormSubmitBar({ children }: { children: ReactNode }) {
  return <div className="form-submit-bar">{children}</div>;
}
