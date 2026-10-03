import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/utils/i18n';
import '@/styles/global.css';
import { PreferencesProvider } from '@/context/PreferencesContext';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </StrictMode>,
);
