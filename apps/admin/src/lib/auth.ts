import { create } from 'zustand';

const TOKEN_KEY = 'tg_admin_token';

export interface AuthState {
  token: string | null;
  setToken: (t: string | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  setToken: (t) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    set({ token: t });
  },
}));
