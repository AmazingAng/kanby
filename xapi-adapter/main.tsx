import React from 'react';
import { createRoot } from 'react-dom/client';
import { KanbanApp } from '../components/kanban-app';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KanbanApp mode="demo" />
  </React.StrictMode>,
);
