import { useNavigate } from 'react-router';
import { aiError, useAiStatus } from '../ai/AiCapture.tsx';
import { useAiConsent } from '../ai/consent.tsx';
import { IdentityConfirmation } from '../ai/IdentityConfirmation.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import type { InboxItem } from './api.ts';
import { parseCapturedInbox } from './parse.ts';

export function InboxIdentity({
  row,
  refresh,
  focus,
}: {
  row: InboxItem;
  refresh: () => Promise<unknown>;
  focus?: boolean;
}) {
  const navigate = useNavigate();
  const state = useAction();
  const status = useAiStatus(row.houseId);
  const consent = useAiConsent(row.houseId, status.data?.provider);
  const version = `v4:${status.data?.provider}`;
  function recognize() {
    void state.run(async () => {
      try {
        await parseCapturedInbox(row.id, version, true);
      } finally {
        await refresh();
      }
    });
  }
  return (
    <>
      <IdentityConfirmation
        focus={focus}
        pending={state.pending}
        disabled={state.disabled || !status.data?.enabled}
        onRecognize={() => {
          if (row.consent === version) recognize();
          else consent.ask(recognize);
        }}
        onManual={() => navigate(`/more/inbox/${row.id}/edit/document`)}
      />
      {state.error ? <Notice error>{aiError(state.error)}</Notice> : null}
      {consent.dialog}
    </>
  );
}
