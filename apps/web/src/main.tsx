import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { AuthRoot } from './auth/AuthRoot.tsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/auth.css';
import './styles/household.css';
import './styles/notes.css';
import './styles/objects.css';
import './styles/organizations.css';
import './styles/meters.css';
import './styles/files.css';
import './styles/deadlines.css';
import './styles/notifications.css';
import { registerShell } from './pwa/register.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0,
      networkMode: 'always',
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});
registerShell();

// Маршруты в части адреса после «#»: прототип работает из любой папки без сервера.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <HashRouter>
        <AuthRoot />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
