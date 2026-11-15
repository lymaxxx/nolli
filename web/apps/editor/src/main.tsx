import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './tokens.css';
import './app.css';

// Lets the stylesheet leave room for the desktop app's own window controls.
document.documentElement.dataset.platform = window.nolliDesktop?.platform ?? 'web';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
