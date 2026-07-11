import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopViewer } from './desktop-viewer.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('Bessel: #root element not found');
createRoot(container).render(
  <StrictMode>
    <DesktopViewer />
  </StrictMode>,
);
