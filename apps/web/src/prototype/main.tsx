import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/shell.css';
import '../styles/components.css';
import '../styles/screens.css';
import { PrototypeApp } from './PrototypeApp.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента #root');

// Маршруты в части адреса после «#»: прототип работает из любой папки без сервера.
createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <PrototypeApp />
    </HashRouter>
  </StrictMode>,
);
