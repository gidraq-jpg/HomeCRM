import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ScopeProvider } from './access/ScopeContext.tsx';
import type { Me } from './auth/api.ts';
import { ExportScreen } from './auth/ExportScreen.tsx';
import { SecurityScreen } from './auth/SecurityScreen.tsx';
import { HouseholdProvider } from './household/HouseholdContext.tsx';
import { NewNoteScreen } from './notes/NewNoteScreen.tsx';
import { NoteScreen } from './notes/NoteScreen.tsx';
import { NotesScreen } from './notes/NotesScreen.tsx';
import { TrashScreen } from './notes/TrashScreen.tsx';
import { NewObjectScreen } from './objects/NewObjectScreen.tsx';
import { ObjectFiles } from './objects/ObjectFiles.tsx';
import { ObjectOverview } from './objects/ObjectOverview.tsx';
import { ObjectScreen } from './objects/ObjectScreen.tsx';
import { ObjectsScreen } from './objects/ObjectsScreen.tsx';
import { ObjectTimeline } from './objects/ObjectTimeline.tsx';
import { DocumentsScreen, TodayScreen } from './screens/EmptySections.tsx';
import { InviteScreen } from './screens/InviteScreen.tsx';
import { MemberScreen } from './screens/MemberScreen.tsx';
import { MoreScreen } from './screens/MoreScreen.tsx';
import { NotFoundScreen } from './screens/NotFoundScreen.tsx';
import { PeopleScreen } from './screens/PeopleScreen.tsx';
import { ProfileScreen } from './screens/ProfileScreen.tsx';
import { SearchScreen } from './screens/SearchScreen.tsx';
import { SpacesScreen } from './screens/SpacesScreen.tsx';
import { AddMenu } from './shell/AddMenu.tsx';
import { AppShell } from './shell/AppShell.tsx';
import { SECTIONS } from './shell/sections.ts';
import { ToastProvider } from './ui/Toast.tsx';

interface AppProps {
  /** Вошедший участник: его роль и дом определяют, что показывать. */
  me: Me;
  reloadMe: () => Promise<void>;
  signOut: () => void;
}

function Workspace({ me, reloadMe, signOut }: AppProps) {
  const [adding, setAdding] = useState(false);
  return (
    <AppShell
      sections={SECTIONS}
      onAdd={() => setAdding(true)}
      overlays={<AddMenu open={adding} onOpenChange={setAdding} />}
    >
      <Routes>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="today" element={<TodayScreen />} />
        <Route path="home" element={<ObjectsScreen />} />
        <Route path="home/new" element={<NewObjectScreen />} />
        <Route path="home/:objectId" element={<ObjectScreen />}>
          <Route index element={<ObjectOverview />} />
          <Route path="timeline" element={<ObjectTimeline />} />
          <Route path="files" element={<ObjectFiles />} />
        </Route>
        <Route path="documents" element={<DocumentsScreen />} />
        <Route path="people" element={<PeopleScreen />} />
        <Route path="people/invite" element={<InviteScreen />} />
        <Route path="people/members/:accountId" element={<MemberScreen />} />
        <Route path="more" element={<MoreScreen />} />
        <Route path="more/profile" element={<ProfileScreen />} />
        <Route
          path="more/settings"
          element={<SecurityScreen me={me} reload={reloadMe} onSignedOut={signOut} />}
        />
        <Route path="more/export" element={<ExportScreen />} />
        <Route path="more/spaces" element={<SpacesScreen />} />
        <Route path="more/notes" element={<NotesScreen />} />
        <Route path="more/notes/new" element={<NewNoteScreen />} />
        <Route path="more/notes/:noteId" element={<NoteScreen />} />
        <Route path="more/trash" element={<TrashScreen />} />
        <Route path="search" element={<SearchScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </AppShell>
  );
}

/**
 * Рабочее приложение вошедшего участника: каркас с меню, шапкой и «+» и экраны на настоящем API.
 * Вымышленные данные прототипа сюда не попадают: они живут в `prototype/` отдельной сборкой.
 * Приложение без маршрутизатора: его подключает `main.tsx` (hash) или тест (в памяти).
 */
export function App(props: AppProps) {
  return (
    <ScopeProvider>
      <ToastProvider>
        <HouseholdProvider me={props.me} reloadMe={props.reloadMe} signOut={props.signOut}>
          <Workspace {...props} />
        </HouseholdProvider>
      </ToastProvider>
    </ScopeProvider>
  );
}
