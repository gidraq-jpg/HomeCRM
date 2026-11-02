import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ScopeProvider } from './access/ScopeContext.tsx';
import { ObjectAccounts } from './accounts/ObjectAccounts.tsx';
import { VoiceAddProvider } from './ai/VoiceAdd.tsx';
import type { Me } from './auth/api.ts';
import { ExportScreen } from './auth/ExportScreen.tsx';
import { SecurityScreen } from './auth/SecurityScreen.tsx';
import { ChargesScreen } from './charges/ChargesScreen.tsx';
import { RadarScreen } from './deadlines/RadarScreen.tsx';
import { DocumentScreen } from './documents/DocumentScreen.tsx';
import { DocumentsScreen } from './documents/DocumentsScreen.tsx';
import { NewDocumentScreen } from './documents/NewDocumentScreen.tsx';
import { HouseholdProvider } from './household/HouseholdContext.tsx';
import { HouseScreen } from './household/HouseScreen.tsx';
import { InboxReview } from './inbox/InboxReview.tsx';
import { InboxScreen } from './inbox/InboxScreen.tsx';
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
import { SummariesScreen } from './notifications/SummariesScreen.tsx';
import { NewObjectScreen } from './objects/NewObjectScreen.tsx';
import { ObjectFiles } from './objects/ObjectFiles.tsx';
import { ObjectOverview } from './objects/ObjectOverview.tsx';
import { ObjectScreen } from './objects/ObjectScreen.tsx';
import { ObjectsScreen } from './objects/ObjectsScreen.tsx';
import { ObjectTimeline } from './objects/ObjectTimeline.tsx';
import { OfflineBridge, OfflinePanel } from './offline/OfflinePanel.tsx';
import { NewOrganizationScreen } from './organizations/NewOrganizationScreen.tsx';
import { OrganizationScreen } from './organizations/OrganizationScreen.tsx';
import { OrganizationsScreen } from './organizations/OrganizationsScreen.tsx';
import { ImportScreen } from './people/ImportScreen.tsx';
import { NewPersonScreen } from './people/NewPersonScreen.tsx';
import { ContactScreen } from './people/PersonScreen.tsx';
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
import { useNavigate } from './shell/motion.tsx';
import { SECTIONS } from './shell/sections.ts';
import { ShoppingCardScreen } from './shopping/ShoppingScreen.tsx';
import { NewTaskScreen } from './tasks/NewTaskScreen.tsx';
import { TaskFeedCarousel } from './tasks/TaskFeedCarousel.tsx';
import { TaskScreen } from './tasks/TaskScreen.tsx';
import { NewFromTemplateScreen } from './templates/NewFromTemplateScreen.tsx';
import { StartScreen } from './templates/StartScreen.tsx';
import { ToastProvider } from './ui/Toast.tsx';
import { MonthScreen } from './utilities/MonthScreen.tsx';

interface AppProps {
  /** Вошедший участник: его роль и дом определяют, что показывать. */
  me: Me;
  reloadMe: () => Promise<void>;
  signOut: () => void;
}

function Workspace({ me, reloadMe, signOut }: AppProps) {
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const [entering, setEntering] = useState(me.firstEntryShown === false);
  useEffect(() => {
    if (entering) {
      navigate('/more/spaces', { replace: true });
      setEntering(false);
    }
  }, [entering, navigate]);
  if (entering) return null;
  return (
    <VoiceAddProvider>
      <AppShell
        sections={SECTIONS}
        onAdd={() => setAdding(true)}
        overlays={<AddMenu open={adding} onOpenChange={setAdding} />}
      >
        <PushBridge accountId={me.id} />
        <OfflineBridge />
        <Routes>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="more/inbox" element={<InboxScreen />} />
          <Route path="more/inbox/new" element={<InboxScreen capture />} />
          <Route path="more/inbox/trash" element={<InboxScreen trash />} />
          <Route path="more/inbox/:inboxId" element={<InboxReview />} />
          <Route path="more/inbox/:inboxId/edit/:editKind" element={<InboxReview />} />
          <Route path="today" element={<TaskFeedCarousel />} />
          <Route path="today/plan" element={<TaskFeedCarousel />} />
          <Route path="today/all" element={<TaskFeedCarousel />} />
          <Route path="today/new" element={<NewTaskScreen />} />
          <Route path="today/tasks/:taskId" element={<TaskScreen />} />
          <Route path="home" element={<ObjectsScreen />} />
          <Route path="home/new" element={<NewObjectScreen />} />
          <Route path="home/month" element={<MonthScreen />} />
          <Route path="home/from-template" element={<NewFromTemplateScreen />} />
          <Route path="home/from-template/:templateId" element={<NewFromTemplateScreen />} />
          <Route path="start" element={<StartScreen />} />
          <Route path="start/object/:templateId" element={<StartScreen fixedStep="object" />} />
          <Route path="start/:step" element={<StartScreen />} />
          <Route path="home/:objectId" element={<ObjectScreen />}>
            <Route index element={<ObjectOverview />} />
            <Route path="timeline" element={<ObjectTimeline />} />
            <Route path="files" element={<ObjectFiles />} />
            <Route path="accounts" element={<ObjectAccounts />} />
            <Route path="accounts/:accountId/charges" element={<ChargesScreen />} />
            <Route path="meters" element={<ObjectMeters />} />
          </Route>
          <Route path="home/:objectId/readings" element={<ReadingsLayout />}>
            <Route index element={<ReadingsEntry />} />
            <Route path="transfer" element={<ReadingsTransfer />} />
          </Route>
          <Route path="documents" element={<DocumentsScreen />} />
          <Route path="documents/new" element={<NewDocumentScreen />} />
          <Route path="documents/:documentId" element={<DocumentScreen />} />
          <Route path="people" element={<PeopleScreen />} />
          <Route path="people/import" element={<ImportScreen />} />
          <Route path="people/contacts/new" element={<NewPersonScreen />} />
          <Route path="people/contacts/:contactId" element={<ContactScreen />} />
          <Route path="people/invite" element={<InviteScreen />} />
          <Route path="people/members/:accountId" element={<MemberScreen />} />
          <Route path="more" element={<MoreScreen />} />
          <Route path="more/shopping" element={<TaskFeedCarousel />} />
          <Route path="more/shopping/:shoppingId" element={<ShoppingCardScreen />} />
          <Route path="more/offline" element={<OfflinePanel />} />
          <Route path="more/profile" element={<ProfileScreen />} />
          <Route
            path="more/settings"
            element={<SecurityScreen me={me} reload={reloadMe} onSignedOut={signOut} />}
          />
          <Route path="more/export" element={<ExportScreen />} />
          <Route
            path="more/spaces"
            element={<SpacesScreen firstEntry={me.firstEntryShown === false} onShown={reloadMe} />}
          />
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
          <Route path="more/summaries" element={<SummariesScreen />} />
          <Route path="more/summaries/:summaryId" element={<SummariesScreen />} />
          <Route path="more/notifications/log" element={<DeliveriesScreen />} />
          <Route path="open/:recordId" element={<OpenRecordScreen />} />
          <Route path="open/:recordId/:screen" element={<OpenRecordScreen />} />
          <Route path="search" element={<SearchScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </AppShell>
    </VoiceAddProvider>
  );
}

/**
 * Рабочее приложение вошедшего участника: каркас с меню, шапкой и «+» и экраны на настоящем API.
 * Вымышленные данные прототипа сюда не попадают: они живут в `prototype/` отдельной сборкой.
 * Приложение без маршрутизатора: его подключает `main.tsx` (hash) или тест (в памяти).
 */
export function App(props: AppProps) {
  return (
    <ScopeProvider key={props.me.id}>
      <ToastProvider>
        <HouseholdProvider me={props.me} reloadMe={props.reloadMe} signOut={props.signOut}>
          <Workspace {...props} />
        </HouseholdProvider>
      </ToastProvider>
    </ScopeProvider>
  );
}
