import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Side-effect import: installs the global zod error map before any resolver runs (D-005).
import './i18n/zod-error-map';
import './styles/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
