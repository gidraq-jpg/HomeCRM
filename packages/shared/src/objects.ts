// Закрытый список OBJ-1; модули коммуналки и документов расширят его своими видами.
export const OBJECT_TYPES = ['property', 'car', 'appliance', 'other'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
