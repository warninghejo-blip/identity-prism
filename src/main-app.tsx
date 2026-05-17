import React from 'react';
import ReactDOM from 'react-dom/client';
import { init } from './bootstrap';
import AppShellApp from './AppShellApp';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import './styles/wallet-adapter-local.css';

init();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShellApp />
  </React.StrictMode>,
);
