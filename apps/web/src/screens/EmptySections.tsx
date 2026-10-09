import { CalendarBlank } from '@phosphor-icons/react';
import { RadarBlock } from '../deadlines/RadarBlock.tsx';
import { ReadingsWindowCards } from '../deadlines/ReadingsWindowCards.tsx';
import { PushCard } from '../notifications/PushCard.tsx';
import { FirstRunCard } from '../templates/FirstRunCard.tsx';
import { SectionPlaceholder } from './SectionPlaceholder.tsx';

// Раздел, данных у которого ещё нет: в нём пока нечего создавать.

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
