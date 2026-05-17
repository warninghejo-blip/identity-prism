import React from 'react';
import ReactDOM from 'react-dom/client';
import { init } from './bootstrap';
import AppShellWeb from './AppShellWeb';
import './index.css';

init();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShellWeb />
  </React.StrictMode>,
);
