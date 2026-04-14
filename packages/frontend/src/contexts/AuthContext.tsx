import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  // Monotonic counter that invalidates in-flight verify calls. Any async
  // verify whose result arrives with a stale sequence is dropped. This
  // prevents the mount-time verify from racing with a user-invoked login()
  // or rotate: if login() bumps the sequence before the old promise resolves,
  // the old result can't clobber the newer principal.
  const verifySeqRef = useRef(0);

  // Initialize from local storage — re-verify with the backend so a stale or
  // wrong key stored from before this fix doesn't grant access. Also
  // re-populates the principal so the UI renders role-appropriately.
  useEffect(() => {
    const storedKey = localStorage.getItem('plexus_admin_key');
    if (!storedKey) return;

    const seq = ++verifySeqRef.current;
    verifyAdminKey(storedKey).then((p) => {
      // A newer verify (from login/rotate) has superseded us — drop this
      // result even if it was successful; whoever bumped the sequence is
      // responsible for setting the current principal.
      if (seq !== verifySeqRef.current) return;
      if (p) {
        setAdminKey(storedKey);
        setPrincipal(p);
      } else {
        localStorage.removeItem('plexus_admin_key');
      }
    });
  }, []);

  const login = async (key: string): Promise<boolean> => {
    const seq = ++verifySeqRef.current;
    const p = await verifyAdminKey(key);
    // If another login/rotate has started while we were awaiting, defer to it.
    if (seq !== verifySeqRef.current) return !!p;
    if (p) {
      localStorage.setItem('plexus_admin_key', key);
      setAdminKey(key);
      setPrincipal(p);
      return true;
    }
    return false;
  };

  const logout = () => {
    // Invalidate any verify in flight so its late resolution doesn't revive
    // the session.
    verifySeqRef.current += 1;
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
