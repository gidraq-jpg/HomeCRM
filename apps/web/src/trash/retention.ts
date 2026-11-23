import type { TrashedFile } from '../files/api.ts';
import { countWord } from '../ui/format.ts';

/** Корзина хранит удалённое 30 дней (DATA-1). Дату удаления ставит база. */
export const RETENTION_DAYS = 30;

export function keepUntil(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000);
}

export const PARENT_LABELS = {
  task: 'из дела',
  note: 'из заметки',
  object: 'из объекта',
  document: 'из документа',
  profile: 'фото профиля',
} as const;

/** Адрес записи, к которой прикреплён удалённый файл; у фото профиля его нет. */
export function parentPathOf(file: Pick<TrashedFile, 'parentType' | 'parentId'>): string | null {
  return file.parentType === 'note'
    ? `/more/notes/${file.parentId}`
    : file.parentType === 'object'
      ? `/home/${file.parentId}/files`
      : file.parentType === 'document'
        ? `/documents/${file.parentId}`
        : file.parentType === 'task'
          ? `/today/tasks/${file.parentId}`
          : null;
}

/** Подпись ссылки к записи файла. */
export function parentLinkLabel(parentType: TrashedFile['parentType']): string {
  return parentType === 'note'
    ? 'К заметке'
    : parentType === 'document'
      ? 'К документу'
      : parentType === 'task'
        ? 'К делу'
        : 'К объекту';
}

export const fileCount = (count: number) => countWord(count, ['файл', 'файла', 'файлов']);
export const recordCount = (count: number) => countWord(count, ['запись', 'записи', 'записей']);
