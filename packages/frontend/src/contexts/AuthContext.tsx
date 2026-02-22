import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  adminKey: string | null;
  isAuthenticated: boolean;
  login: (key: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [adminKey, setAdminKey] = useState<string | null>(null);

  // Initialize from local storage
  useEffect(() => {
    const storedKey = localStorage.getItem('plexus_admin_key');
    if (storedKey) {
      setAdminKey(storedKey);
    }
  }, []);

  const login = (key: string) => {
    localStorage.setItem('plexus_admin_key', key);
    setAdminKey(key);
  };

  const logout = () => {
    localStorage.removeItem('plexus_admin_key');
    setAdminKey(null);
  };

  return (
    <AuthContext.Provider
      value={{
        adminKey,
        isAuthenticated: !!adminKey,
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
