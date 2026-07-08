import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';

const Ask = lazy(() => import('./pages/Ask'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const Skills = lazy(() => import('./pages/Skills'));

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-terminal-gray/60 font-mono text-sm">
          <span className="text-terminal-pink">~$</span> booting agent…
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Ask />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="skills" element={<Skills />} />
          <Route path="*" element={<Ask />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
