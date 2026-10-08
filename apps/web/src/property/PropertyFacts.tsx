import type { PropertyData } from '@homecrm/shared';
import { usePersonName } from '../objects/context.ts';
import { PropertyStatusBadge } from './PropertyStatusBadge.tsx';
import { formatArea, PROPERTY_KIND_LABELS } from './property.ts';

/** Строки «Вид, адрес, площадь, кадастровый номер, статус, собственники» в карточке недвижимости. */
export function PropertyFacts({ data }: { data: PropertyData }) {
  const nameOf = usePersonName();
  const owners = data.ownerMemberIds ?? [];
  return (
    <>
      {data.kind === undefined ? null : (
        <div className="facts__item">
          <dt>Вид</dt>
          <dd>{PROPERTY_KIND_LABELS[data.kind]}</dd>
        </div>
      )}
      {data.status === undefined ? null : (
        <div className="facts__item">
          <dt>Статус</dt>
          <dd>
            <PropertyStatusBadge status={data.status} />
          </dd>
        </div>
      )}
      {data.address === undefined || data.address === '' ? null : (
        <div className="facts__item">
          <dt>Адрес</dt>
          <dd>{data.address}</dd>
        </div>
      )}
      {data.areaHundredths === undefined ? null : (
        <div className="facts__item">
          <dt>Площадь</dt>
          <dd>{formatArea(data.areaHundredths)}</dd>
        </div>
      )}
      {data.cadastralNumber === undefined ? null : (
        <div className="facts__item">
          <dt>Кадастровый номер</dt>
          <dd className="mono">{data.cadastralNumber}</dd>
        </div>
      )}
      {owners.length === 0 ? null : (
        <div className="facts__item">
          <dt>Собственники</dt>
          <dd>{owners.map((id) => nameOf(id)).join(', ')}</dd>
        </div>
      )}
    </>
  );
}
