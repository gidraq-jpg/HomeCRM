import type { ReactNode } from 'react';
import { ScopeProvider } from './access/ScopeContext.tsx';
import { AddSheet } from './prototype/AddSheet.tsx';
import { AddRequestContext, useAddController } from './prototype/add-request.tsx';
import { PrototypeRoutes } from './prototype/routes.tsx';
import { PrototypeProvider } from './prototype/store.tsx';
import { AppShell } from './shell/AppShell.tsx';
import { SECTIONS } from './shell/sections.ts';
import { ToastProvider } from './ui/Toast.tsx';

// Каркас приложения (шапка, нижнее меню, «+», переключатель) остаётся и в R0.3.
// Всё из папки prototype/ — вымышленные данные и экраны на них — потом заменят настоящие.

function PrototypeApp({
  settings,
  exportScreen,
}: {
  settings?: ReactNode;
  exportScreen?: ReactNode;
}) {
  const add = useAddController();
  return (
    <AddRequestContext.Provider value={add.request}>
      <AppShell
        sections={SECTIONS}
        onAdd={() => add.request()}
        overlays={<AddSheet controller={add} />}
      >
        <PrototypeRoutes settings={settings} exportScreen={exportScreen} />
      </AppShell>
    </AddRequestContext.Provider>
  );
}

/** Приложение без маршрутизатора: его подключает `main.tsx` (hash) или тест (в памяти). */
export function App({
  settings,
  exportScreen,
}: {
  settings?: ReactNode;
  exportScreen?: ReactNode;
} = {}) {
  return (
    <ScopeProvider>
      <PrototypeProvider>
        <ToastProvider>
          <PrototypeApp settings={settings} exportScreen={exportScreen} />
        </ToastProvider>
      </PrototypeProvider>
    </ScopeProvider>
  );
}
