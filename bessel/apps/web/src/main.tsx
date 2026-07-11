import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// Style order is load-bearing: selene tokens + @font-face first, then the bridge
// re-points the app token names at selene, then the app's light theme + non-color
// tokens, then the components that consume them.
import '@bessel/selene-design/styles.css';
import './styles/selene-bridge.css';
import './styles/tokens.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Bessel: #root element not found');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
