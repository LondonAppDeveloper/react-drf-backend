import React, { createContext, useContext, useState, useEffect } from 'react';
import { loginRequest, refreshAccessToken } from '@/services/api';

const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
};

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean; // <--- Importante para tu ProtectedRoute
  user: any | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Empezamos cargando
  const [user, setUser] = useState(null);

  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setIsLoading(false);
        return;
      }

      if (!isTokenExpired(token)) {
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }

      // El access token venció: intentamos renovarlo antes de mostrar cualquier vista protegida.
      try {
        await refreshAccessToken();
        setIsAuthenticated(true);
      } catch {
        localStorage.clear();
        setIsAuthenticated(false);
      }
      setIsLoading(false);
    };

    verifySession();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const response = await loginRequest({ username, password });
      localStorage.setItem('token', response.data.access);
      localStorage.setItem('refreshToken', response.data.refresh);
      setIsAuthenticated(true);
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    localStorage.clear();
    setIsAuthenticated(false);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};