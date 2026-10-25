import { MeterPhotoDraft } from '@homecrm/shared';
import { useRef, useState } from 'react';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { PhotoCapture } from '../ai/PhotoCapture.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { CheckLine } from '../ui/CheckLine.tsx';
import type { MeterListItem } from './api.ts';
import type { ReadingsContext } from './ReadingsLayout.tsx';
import { emptyDraft } from './readings.ts';

export function MeterPhoto({ meter, ctx }: { meter: MeterListItem; ctx: ReadingsContext }) {
  const { householdId } = useHousehold();
  const status = useAiStatus(householdId);
  const [keep, setKeep] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [problem, setProblem] = useState('');
  const selected = useRef<File | null>(null);
  const retain = useRef(false);
  const latest = useRef(ctx);
  latest.current = ctx;
  function attach(file: File | null, retain: boolean) {
    const current = latest.current;
    const photos = (current.files[meter.id] ?? []).filter((photo) => photo !== selected.current);
    selected.current = file;
    if (retain && file && photos.length >= 3) {
      setProblem(
        'К показанию уже приложено три фото. Уберите одно, чтобы приложить снимок разбора.',
      );
      return;
    }
    setProblem('');
    current.setFiles(meter.id, retain && file ? [...photos, file] : photos);
  }
  if (!status.data?.enabled) return null;
  return (
    <>
      <PhotoCapture
        house={householdId}
        path={`meter-photo?meterId=${meter.id}`}
        schema={MeterPhotoDraft}
        label="С фото"
        onResult={(result, file) => {
          const current = latest.current;
          const draft = current.drafts[meter.id] ?? emptyDraft(meter.data.zones.length);
          current.setDraft(meter.id, {
            ...draft,
            values: result.values.map((field, index) => field.value ?? draft.values[index] ?? ''),
          });
          setUncertain(result.values.some((field) => !field.confident));
          attach(file, retain.current);
        }}
      />
      <CheckLine
        checked={keep}
        onChange={(checked) => {
          retain.current = checked;
          setKeep(checked);
          attach(selected.current, checked);
        }}
      >
        Приложить фото к показанию
      </CheckLine>
      {uncertain ? (
        <p role="status">Не все цифры уверенно прочитаны — проверьте значения по фото.</p>
      ) : null}
      {problem ? <p role="alert">{problem}</p> : null}
    </>
  );
}
