import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

import './styles/tokens.css';
import './styles/app.css';
import './styles/hero.css';
import './styles/canvas.css';
import './styles/terminal.css';
import './styles/command.css';
import './styles/panels.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element to mount the console into');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
