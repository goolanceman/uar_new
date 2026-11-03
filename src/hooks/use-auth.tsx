"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { get, post, setToken } from "@/lib/api-client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "VOLUNTEER" | "DONOR" | "BENEFICIARY" | string;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | string;
  phone?: string | null;
  city?: string | null;
}

export interface TempCreds {
  email: string;
  password: string;
  fullName: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (data: {
    name: string;
    email: string;
    phone: string;
    city: string;
    role: string;
  }) => Promise<TempCreds>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Retry transient network failures (dev server restarts, cold starts) so
    // a live session is never dropped because of a momentary blip.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await get<{ user: SessionUser | null }>("/api/auth/me");
        setUser(data.user);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : "";
        // 401 means genuinely unauthenticated — stop retrying immediately.
        if (/sign in|401|Invalid/i.test(msg)) {
          setUser(null);
          setLoading(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    console.warn("[auth] session check failed after retries", lastErr);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await post<{ user: SessionUser; token?: string }>(
      "/api/auth/login",
      { email, password }
    );
    if (data.token) setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (data: {
      name: string;
      email: string;
      phone: string;
      city: string;
      role: string;
    }) => {
      const res = await post<{
        user: SessionUser;
        token?: string;
        tempCreds: TempCreds;
      }>("/api/auth/register", data);
      if (res.token) setToken(res.token);
      setUser(res.user);
      return res.tempCreds;
    },
    []
  );

  const logout = useCallback(async () => {
    setToken(null);
    await post("/api/auth/logout");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
