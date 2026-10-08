import { CalendarBlank, FileText } from '@phosphor-icons/react';
import { RadarBlock } from '../deadlines/RadarBlock.tsx';
import { ReadingsWindowCards } from '../deadlines/ReadingsWindowCards.tsx';
import { PushCard } from '../notifications/PushCard.tsx';
import { FirstRunCard } from '../templates/FirstRunCard.tsx';
import { SectionPlaceholder } from './SectionPlaceholder.tsx';

// Два раздела, данных у которых ещё нет: в них пока нечего создавать.

export function TodayScreen() {
  return (
    <SectionPlaceholder
      title="Сегодня"
      icon={<CalendarBlank size={24} aria-hidden />}
      top={
        <>
          <FirstRunCard />
          <ReadingsWindowCards />
          <RadarBlock />
          <PushCard />
        </>
      }
      lead="Дел на сегодня пока нет"
      now="Создавать дела в приложении пока нельзя: раздел не готов. Сроки из карточек объектов и заметок собираются в радаре."
      will="Когда в приложении появятся дела, здесь соберутся главное дело и дела на сегодня."
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
