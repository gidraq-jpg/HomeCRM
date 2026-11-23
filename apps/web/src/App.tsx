import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ScopeProvider } from './access/ScopeContext.tsx';
import { useVoiceAdd, VoiceAddProvider } from './ai/VoiceAdd.tsx';
import type { Me } from './auth/api.ts';
import { HouseholdProvider } from './household/HouseholdContext.tsx';
import { PushBridge } from './notifications/PushBridge.tsx';
import { OfflineBridge, OfflinePanel } from './offline/OfflinePanel.tsx';
import { useSectionPrefetch } from './prefetch.ts';
import { AppShell } from './shell/AppShell.tsx';
import { SECTIONS } from './shell/sections.ts';
import { QuickAddSheet } from './tasks/QuickAddSheet.tsx';
import { TaskFeedCarousel } from './tasks/TaskFeedCarousel.tsx';
import { TaskSwipeActions } from './tasks/TaskSwipeActions.tsx';
import { useNavigate } from './ui/navigation.tsx';
import { ScreenFallback } from './ui/ScreenFallback.tsx';
import { ToastProvider } from './ui/Toast.tsx';
import { AddMenu } from './workspace/AddMenu.tsx';
import {
  documentsSection,
  homeSection,
  inboxSection,
  moreSection,
  peopleSection,
  rareSection,
  tasksSection,
} from './workspace/sections.ts';
import { TodayAvatar, TodayDate } from './workspace/TopBarParts.tsx';

// Экраны разделов грузятся частями сборки (D53c); лента «Сегодня» — в основной части.
const NewTaskScreen = tasksSection.screen('NewTaskScreen');
const TaskScreen = tasksSection.screen('TaskScreen');

const ObjectAccounts = homeSection.screen('ObjectAccounts');
const ChargesScreen = homeSection.screen('ChargesScreen');
const ObjectMeters = homeSection.screen('ObjectMeters');
const ReadingsEntry = homeSection.screen('ReadingsEntry');
const ReadingsLayout = homeSection.screen('ReadingsLayout');
const ReadingsPicker = homeSection.screen('ReadingsPicker');
const ReadingsTransfer = homeSection.screen('ReadingsTransfer');
const NewObjectScreen = homeSection.screen('NewObjectScreen');
const ObjectFiles = homeSection.screen('ObjectFiles');
const ObjectOverview = homeSection.screen('ObjectOverview');
const ObjectScreen = homeSection.screen('ObjectScreen');
const ObjectsScreen = homeSection.screen('ObjectsScreen');
const ObjectTimeline = homeSection.screen('ObjectTimeline');
const NewFromTemplateScreen = homeSection.screen('NewFromTemplateScreen');
const StartScreen = homeSection.screen('StartScreen');
const MonthScreen = homeSection.screen('MonthScreen');

const DocumentScreen = documentsSection.screen('DocumentScreen');
const DocumentsScreen = documentsSection.screen('DocumentsScreen');
const NewDocumentScreen = documentsSection.screen('NewDocumentScreen');

const ImportScreen = peopleSection.screen('ImportScreen');
const NewPersonScreen = peopleSection.screen('NewPersonScreen');
const ContactScreen = peopleSection.screen('ContactScreen');
const InviteScreen = peopleSection.screen('InviteScreen');
const MemberScreen = peopleSection.screen('MemberScreen');
const PeopleScreen = peopleSection.screen('PeopleScreen');

const InboxReview = inboxSection.screen('InboxReview');
const InboxScreen = inboxSection.screen('InboxScreen');

const ExportScreen = moreSection.screen('ExportScreen');
const SecurityScreen = moreSection.screen('SecurityScreen');
const RadarScreen = moreSection.screen('RadarScreen');
const HouseScreen = moreSection.screen('HouseScreen');
const NewNoteScreen = moreSection.screen('NewNoteScreen');
const NoteScreen = moreSection.screen('NoteScreen');
const NotesScreen = moreSection.screen('NotesScreen');
const TrashScreen = moreSection.screen('TrashScreen');
const DeliveriesScreen = moreSection.screen('DeliveriesScreen');
const NotificationsScreen = moreSection.screen('NotificationsScreen');
const SummariesScreen = moreSection.screen('SummariesScreen');
const NewOrganizationScreen = moreSection.screen('NewOrganizationScreen');
const OrganizationScreen = moreSection.screen('OrganizationScreen');
const OrganizationsScreen = moreSection.screen('OrganizationsScreen');
const MoreScreen = moreSection.screen('MoreScreen');
const ProfileScreen = moreSection.screen('ProfileScreen');
const SpacesScreen = moreSection.screen('SpacesScreen');
const ShoppingCardScreen = moreSection.screen('ShoppingCardScreen');

const OpenRecordScreen = rareSection.screen('OpenRecordScreen');
const NotFoundScreen = rareSection.screen('NotFoundScreen');
const SearchScreen = rareSection.screen('SearchScreen');

interface AppProps {
  /** Вошедший участник: его роль и дом определяют, что показывать. */
  me: Me;
  reloadMe: () => Promise<void>;
  signOut: () => void;
}

const quickAdd = (onOpenChange: (open: boolean) => void) => (
  <QuickAddSheet open onOpenChange={onOpenChange} />
);

/** Каркас с вставками модулей: голос, быстрая строка дела, жесты строк, дата и аватар. */
function WorkspaceShell({ children }: { children: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const voice = useVoiceAdd();
  return (
    <AppShell
      sections={SECTIONS}
      onAdd={() => setAdding(true)}
      overlays={<AddMenu open={adding} onOpenChange={setAdding} />}
      quickAdd={quickAdd}
      mainWrapper={TaskSwipeActions}
      voice={voice}
      todayDate={<TodayDate />}
      profileAvatar={<TodayAvatar />}
    >
      {children}
    </AppShell>
  );
}

function Workspace({ me, reloadMe, signOut }: AppProps) {
  const navigate = useNavigate();
  const [entering, setEntering] = useState(me.firstEntryShown === false);
  useSectionPrefetch();
  useEffect(() => {
    if (entering) {
      navigate('/more/spaces', { replace: true });
      setEntering(false);
    }
  }, [entering, navigate]);
  if (entering) return null;
  return (
    <VoiceAddProvider>
      <WorkspaceShell>
        <PushBridge accountId={me.id} />
        <OfflineBridge />
        <Suspense fallback={<ScreenFallback />}>
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
              element={
                <SpacesScreen firstEntry={me.firstEntryShown === false} onShown={reloadMe} />
              }
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
        </Suspense>
      </WorkspaceShell>
    </VoiceAddProvider>
  );
}

/**
 * Рабочее приложение вошедшего участника: каркас с меню, шапкой и «+» и экраны на настоящем API.
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
