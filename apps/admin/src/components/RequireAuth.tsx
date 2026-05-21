import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const loc = useLocation();
  if (!token) {
    return <Navigate to="login" replace state={{ from: loc.pathname }} />;
  }
  return <>{children}</>;
}
