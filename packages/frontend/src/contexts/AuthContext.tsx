import React, { createContext, useContext, useState, useEffect } from 'react';
import { verifyAdminKey, type Principal } from '../lib/api';

interface AuthContextType {
  /**
   * The credential in localStorage. NOTE: this slot predates api-key login
   * support, so the stored value may be either an ADMIN_KEY or an api_keys
   * secret. The name is retained for back-compat with existing sessions.
   */
  adminKey: string | null;
  /** Principal returned by the backend's verify endpoint, or null if unauthenticated. */
  principal: Principal | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLimited: boolean;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);

  // Initialize from local storage — re-verify with the backend so a stale or
  // wrong key stored from before this fix doesn't grant access. Also
  // re-populates the principal so the UI renders role-appropriately.
  useEffect(() => {
    const storedKey = localStorage.getItem('plexus_admin_key');
    if (storedKey) {
      verifyAdminKey(storedKey).then((p) => {
        if (p) {
          setAdminKey(storedKey);
          setPrincipal(p);
        } else {
          localStorage.removeItem('plexus_admin_key');
        }
      });
    }
  }, []);

  const login = async (key: string): Promise<boolean> => {
    const p = await verifyAdminKey(key);
    if (p) {
      localStorage.setItem('plexus_admin_key', key);
      setAdminKey(key);
      setPrincipal(p);
      return true;
    }
    return false;
  };

  const logout = () => {
    localStorage.removeItem('plexus_admin_key');
    setAdminKey(null);
    setPrincipal(null);
  };

  return (
    <AuthContext.Provider
      value={{
        adminKey,
        principal,
        isAuthenticated: !!adminKey,
        isAdmin: principal?.role === 'admin',
        isLimited: principal?.role === 'limited',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
