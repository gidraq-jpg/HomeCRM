import { Files } from '@phosphor-icons/react';
import { EmptyState } from '../ui/EmptyState.tsx';

/** Вкладка «Файлы» (OBJ-4): место под неё есть, а загрузки в приложении ещё нет. Данных здесь нет. */
export function ObjectFiles() {
  return (
    <EmptyState icon={<Files size={24} aria-hidden />} title="Файлов пока нет">
      <p>Добавить фото и PDF к объекту в приложении пока нельзя: загрузка файлов не готова.</p>
      <p>Файлы будут доступны тем же людям, что и сам объект.</p>
    </EmptyState>
  );
}
