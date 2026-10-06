import { Buildings, CalendarBlank, FileText } from '@phosphor-icons/react';
import { SectionPlaceholder } from './SectionPlaceholder.tsx';

// Три раздела, данных у которых ещё нет: в них пока нечего создавать.

export function TodayScreen() {
  return (
    <SectionPlaceholder
      title="Сегодня"
      icon={<CalendarBlank size={24} aria-hidden />}
      lead="На сегодня пока ничего нет"
      now="Дел, сроков и документов в приложении ещё нет, поэтому собирать нечего. Создавать их пока нельзя: эти разделы не готовы."
      will="Когда в приложении появятся дела и сроки, здесь соберутся срочное, главное дело и дела на сегодня."
    />
  );
}

export function HomeScreen() {
  return (
    <SectionPlaceholder
      title="Дом"
      icon={<Buildings size={24} aria-hidden />}
      lead="Объектов пока нет"
      now="Завести квартиру или дачу в приложении пока нельзя: раздел не готов."
      will="Здесь будут объекты недвижимости, коммуналка за месяц и карточки объектов."
    />
  );
}

export function DocumentsScreen() {
  return (
    <SectionPlaceholder
      title="Документы"
      icon={<FileText size={24} aria-hidden />}
      lead="Документов пока нет"
      now="Добавлять документы в приложении пока нельзя: раздел не готов."
      will="Здесь будут документы со сроками, номерами и файлами, с фильтрами по человеку и объекту."
    />
  );
}
