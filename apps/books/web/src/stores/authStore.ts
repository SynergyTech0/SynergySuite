import { create } from 'zustand';
import { apiFetch } from '../lib/api';

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
};

type AuthState = {
  user: AuthUser | null;
  suiteDomain: string | null;
  /** Loads the signed-in user. The suite gateway has already signed them in with SynergyAuth. */
  load: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  suiteDomain: null,
  load: async () => {
    const data = await apiFetch<{ user: AuthUser; suiteDomain: string | null }>('/auth/me');
    set({ user: data.user, suiteDomain: data.suiteDomain });
  },
}));
