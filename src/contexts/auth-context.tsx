import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  getCurrentUser,
  loginWithGoogle,
  loginUser,
  refreshUserSession,
  registerUser,
  type Token,
  type UserCreate,
  type UserLogin,
  type UserResponse,
} from "@/lib/api";

type LoginOptions = {
  remember?: boolean;
};

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  user: UserResponse;
  remember: boolean;
};

type AuthContextValue = {
  user: UserResponse | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: UserLogin, options?: LoginOptions) => Promise<UserResponse>;
  loginGoogle: (credential: string, options?: LoginOptions) => Promise<UserResponse>;
  register: (payload: UserCreate, options?: LoginOptions) => Promise<UserResponse>;
  refreshSession: () => Promise<UserResponse | null>;
  logout: () => void;
};

const LOCAL_STORAGE_KEY = "curl2py:auth:local:v1";
const SESSION_STORAGE_KEY = "curl2py:auth:session:v1";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function storageKey(remember: boolean): string {
  return remember ? LOCAL_STORAGE_KEY : SESSION_STORAGE_KEY;
}

function readStoredSession(): StoredSession | null {
  try {
    const localValue = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (localValue) {
      return JSON.parse(localValue) as StoredSession;
    }

    const sessionValue = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (sessionValue) {
      return JSON.parse(sessionValue) as StoredSession;
    }
  } catch {
    return null;
  }

  return null;
}

function persistStoredSession(session: StoredSession) {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);

    const targetStorage = session.remember ? window.localStorage : window.sessionStorage;
    targetStorage.setItem(storageKey(session.remember), JSON.stringify(session));
  } catch {
    // Ignore storage errors; the in-memory session still works.
  }
}

function clearStoredSession() {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors on logout.
  }
}

async function resolveSession(session: StoredSession): Promise<StoredSession | null> {
  try {
    const user = await getCurrentUser(session.accessToken);
    return {
      ...session,
      user,
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      return null;
    }

    try {
      const refreshed: Token = await refreshUserSession({ refresh_token: session.refreshToken });
      const user = await getCurrentUser(refreshed.access_token);
      return {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        user,
        remember: session.remember,
      };
    } catch {
      return null;
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const stored = readStoredSession();
      if (!stored) {
        if (active) {
          setIsLoading(false);
        }
        return;
      }

      const resolved = await resolveSession(stored);
      if (!active) {
        return;
      }

      if (resolved) {
        setSession(resolved);
        persistStoredSession(resolved);
      } else {
        clearStoredSession();
        setSession(null);
      }

      setIsLoading(false);
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const login = async (payload: UserLogin, options: LoginOptions = {}) => {
    const remember = options.remember ?? true;
    const tokens = await loginUser(payload);
    const user = await getCurrentUser(tokens.access_token);
    const nextSession: StoredSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      user,
      remember,
    };

    setSession(nextSession);
    persistStoredSession(nextSession);

    return user;
  };

  const loginGoogle = async (credential: string, options: LoginOptions = {}) => {
    const remember = options.remember ?? true;
    const tokens = await loginWithGoogle({ credential });
    const user = await getCurrentUser(tokens.access_token);
    const nextSession: StoredSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      user,
      remember,
    };

    setSession(nextSession);
    persistStoredSession(nextSession);

    return user;
  };

  const register = async (payload: UserCreate, options: LoginOptions = {}) => {
    await registerUser(payload);
    return login(
      {
        username: payload.username,
        password: payload.password,
      },
      options,
    );
  };

  const refreshSession = async () => {
    if (!session) {
      return null;
    }

    try {
      const refreshed = await refreshUserSession({ refresh_token: session.refreshToken });
      const user = await getCurrentUser(refreshed.access_token);
      const nextSession: StoredSession = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        user,
        remember: session.remember,
      };

      setSession(nextSession);
      persistStoredSession(nextSession);
      return user;
    } catch {
      clearStoredSession();
      setSession(null);
      return null;
    }
  };

  const logout = () => {
    clearStoredSession();
    setSession(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? null,
    refreshToken: session?.refreshToken ?? null,
    isAuthenticated: !!session,
    isLoading,
    login,
    loginGoogle,
    register,
    refreshSession,
    logout,
  }), [session, isLoading, login, loginGoogle, register, refreshSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
