import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ScopeProvider } from './access/ScopeContext.tsx';
import { ObjectAccounts } from './accounts/ObjectAccounts.tsx';
import type { Me } from './auth/api.ts';
import { ExportScreen } from './auth/ExportScreen.tsx';
import { SecurityScreen } from './auth/SecurityScreen.tsx';
import { RadarScreen } from './deadlines/RadarScreen.tsx';
import { HouseholdProvider } from './household/HouseholdContext.tsx';
import { HouseScreen } from './household/HouseScreen.tsx';
import { ObjectMeters } from './meters/ObjectMeters.tsx';
import { ReadingsEntry } from './meters/ReadingsEntry.tsx';
import { ReadingsLayout } from './meters/ReadingsLayout.tsx';
import { ReadingsPicker } from './meters/ReadingsPicker.tsx';
import { ReadingsTransfer } from './meters/ReadingsTransfer.tsx';
import { NewNoteScreen } from './notes/NewNoteScreen.tsx';
import { NoteScreen } from './notes/NoteScreen.tsx';
import { NotesScreen } from './notes/NotesScreen.tsx';
import { TrashScreen } from './notes/TrashScreen.tsx';
import { DeliveriesScreen } from './notifications/DeliveriesScreen.tsx';
import { NotificationsScreen } from './notifications/NotificationsScreen.tsx';
import { OpenRecordScreen } from './notifications/OpenRecordScreen.tsx';
import { PushBridge } from './notifications/PushBridge.tsx';
import { NewObjectScreen } from './objects/NewObjectScreen.tsx';
import { ObjectFiles } from './objects/ObjectFiles.tsx';
import { ObjectOverview } from './objects/ObjectOverview.tsx';
import { ObjectScreen } from './objects/ObjectScreen.tsx';
import { ObjectsScreen } from './objects/ObjectsScreen.tsx';
import { ObjectTimeline } from './objects/ObjectTimeline.tsx';
import { NewOrganizationScreen } from './organizations/NewOrganizationScreen.tsx';
import { OrganizationScreen } from './organizations/OrganizationScreen.tsx';
import { OrganizationsScreen } from './organizations/OrganizationsScreen.tsx';
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
      <PushBridge accountId={me.id} />
      <Routes>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="today" element={<TodayScreen />} />
        <Route path="home" element={<ObjectsScreen />} />
        <Route path="home/new" element={<NewObjectScreen />} />
        <Route path="home/:objectId" element={<ObjectScreen />}>
          <Route index element={<ObjectOverview />} />
          <Route path="timeline" element={<ObjectTimeline />} />
          <Route path="files" element={<ObjectFiles />} />
          <Route path="accounts" element={<ObjectAccounts />} />
          <Route path="meters" element={<ObjectMeters />} />
        </Route>
        <Route path="home/:objectId/readings" element={<ReadingsLayout />}>
          <Route index element={<ReadingsEntry />} />
          <Route path="transfer" element={<ReadingsTransfer />} />
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
        <Route path="more/readings" element={<ReadingsPicker />} />
        <Route path="more/notes" element={<NotesScreen />} />
        <Route path="more/notes/new" element={<NewNoteScreen />} />
        <Route path="more/notes/:noteId" element={<NoteScreen />} />
        <Route path="more/organizations" element={<OrganizationsScreen />} />
        <Route path="more/organizations/new" element={<NewOrganizationScreen />} />
        <Route path="more/organizations/:organizationId" element={<OrganizationScreen />} />
        <Route path="more/trash" element={<TrashScreen />} />
        <Route path="more/radar" element={<RadarScreen />} />
        <Route path="more/house" element={<HouseScreen />} />
        <Route path="more/notifications" element={<NotificationsScreen />} />
        <Route path="more/notifications/log" element={<DeliveriesScreen />} />
        <Route path="open/:recordId" element={<OpenRecordScreen />} />
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
