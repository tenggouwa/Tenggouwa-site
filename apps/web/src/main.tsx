import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startVitals } from './lib/vitals';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

startVitals();
