import { AddressBook, Buildings, CalendarBlank, DotsThree, FileText } from '@phosphor-icons/react';
import type { ShellSection } from './BottomNav.tsx';

/** Пять разделов нижнего меню — PRD, раздел 14. */
export const SECTIONS: readonly ShellSection[] = [
  { to: '/today', label: 'Сегодня', icon: CalendarBlank },
  { to: '/home', label: 'Дом', icon: Buildings },
  { to: '/documents', label: 'Документы', icon: FileText },
  { to: '/people', label: 'Люди', icon: AddressBook },
  { to: '/more', label: 'Ещё', icon: DotsThree },
];
