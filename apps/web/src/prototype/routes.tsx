import { Navigate, Route, Routes } from 'react-router';
import { NotFoundScreen } from './components.tsx';
import { DocumentScreen, DocumentsScreen } from './screens/Documents.tsx';
import {
  HomeScreen,
  PropertyDocuments,
  PropertyFeed,
  PropertyMeters,
  PropertyOverview,
  PropertyPeople,
  PropertyScreen,
  PropertyUtilities,
} from './screens/Home.tsx';
import { MonthScreen } from './screens/Month.tsx';
import {
  ExportScreen,
  MoreScreen,
  SettingsScreen,
  SpacesScreen,
  TrashScreen,
} from './screens/More.tsx';
import { NoteScreen, NotesScreen } from './screens/Notes.tsx';
import { ContactScreen, PeopleScreen } from './screens/People.tsx';
import { RadarScreen } from './screens/Radar.tsx';
import { ReadingsScreen } from './screens/Readings.tsx';
import { SearchScreen } from './screens/Search.tsx';
import { ShoppingScreen } from './screens/Shopping.tsx';
import { AllTasksScreen, PlanScreen, TodayScreen } from './screens/Tasks.tsx';

/** Все маршруты прототипа: образец экранов; рабочее приложение их не использует. */
export function PrototypeRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/today" replace />} />

      <Route path="today" element={<TodayScreen />} />
      <Route path="today/plan" element={<PlanScreen />} />
      <Route path="today/all" element={<AllTasksScreen />} />

      <Route path="home" element={<HomeScreen />} />
      <Route path="home/month" element={<MonthScreen />} />
      <Route path="home/:propertyId" element={<PropertyScreen />}>
        <Route index element={<PropertyOverview />} />
        <Route path="utilities" element={<PropertyUtilities />} />
        <Route path="meters" element={<PropertyMeters />} />
        <Route path="documents" element={<PropertyDocuments />} />
        <Route path="people" element={<PropertyPeople />} />
        <Route path="feed" element={<PropertyFeed />} />
      </Route>
      <Route path="home/:propertyId/readings" element={<ReadingsScreen />} />

      <Route path="documents" element={<DocumentsScreen />} />
      <Route path="documents/:documentId" element={<DocumentScreen />} />

      <Route path="people" element={<PeopleScreen />} />
      <Route path="people/:contactId" element={<ContactScreen />} />

      <Route path="more" element={<MoreScreen />} />
      <Route path="more/notes" element={<NotesScreen />} />
      <Route path="more/notes/:noteId" element={<NoteScreen />} />
      <Route path="more/shopping" element={<ShoppingScreen />} />
      <Route path="more/radar" element={<RadarScreen />} />
      <Route path="more/settings" element={<SettingsScreen />} />
      <Route path="more/trash" element={<TrashScreen />} />
      <Route path="more/export" element={<ExportScreen />} />
      <Route path="more/spaces" element={<SpacesScreen />} />

      <Route path="search" element={<SearchScreen />} />
      <Route path="*" element={<NotFoundScreen what="Страница не найдена" />} />
    </Routes>
  );
}
