import { OBJECT_TYPES, type ObjectType } from '@homecrm/shared';
import { Buildings, Car, Cube, type Icon, Wrench } from '@phosphor-icons/react';
import { countWord } from '../ui/format.ts';

// Типы объектов — закрытый список OBJ-1: недвижимость, машина, техника, другое.

export { OBJECT_TYPES, type ObjectType };

export const OBJECT_TYPE_LABELS: Readonly<Record<ObjectType, string>> = {
  property: 'Недвижимость',
  car: 'Машина',
  appliance: 'Техника',
  other: 'Другое',
};

/** Заголовки групп в списке «Дома». */
export const OBJECT_TYPE_GROUPS: Readonly<Record<ObjectType, string>> = {
  property: 'Недвижимость',
  car: 'Машины',
  appliance: 'Техника',
  other: 'Другое',
};

export const OBJECT_TYPE_ICONS: Readonly<Record<ObjectType, Icon>> = {
  property: Buildings,
  car: Car,
  appliance: Wrench,
  other: Cube,
};

/** Сколько объектов по-русски: «1 объект», «2 объекта», «5 объектов». */
export const objectCount = (count: number) => countWord(count, ['объект', 'объекта', 'объектов']);
