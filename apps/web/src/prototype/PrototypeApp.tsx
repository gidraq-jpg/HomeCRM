import { ScopeProvider } from '../access/ScopeContext.tsx';
import { AppShell } from '../shell/AppShell.tsx';
import { SECTIONS } from '../shell/sections.ts';
import { ToastProvider } from '../ui/Toast.tsx';
import { AddSheet } from './AddSheet.tsx';
import { AddRequestContext, useAddController } from './add-request.tsx';
import { PrototypeRoutes } from './routes.tsx';
import { PrototypeProvider } from './store.tsx';

// Кликабельный прототип навигации (задача 0.5): вымышленные данные семьи Орловых, без входа
// и сервера. Это образец экранов для R0.4b, R1a и дальше; рабочее приложение его не показывает.
// Собирается отдельно: `vite build --mode prototype` (страница prototype.html).

function Prototype() {
  const add = useAddController();
  return (
    <AddRequestContext.Provider value={add.request}>
      <AppShell
        sections={SECTIONS}
        onAdd={() => add.request()}
        overlays={<AddSheet controller={add} />}
      >
        <PrototypeRoutes />
      </AppShell>
    </AddRequestContext.Provider>
  );
}

/** Прототип без маршрутизатора: его подключает `main.tsx` прототипа (hash) или тест (в памяти). */
export function PrototypeApp() {
  return (
    <ScopeProvider>
      <PrototypeProvider>
        <ToastProvider>
          <Prototype />
        </ToastProvider>
      </PrototypeProvider>
    </ScopeProvider>
  );
}
