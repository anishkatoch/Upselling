import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  /** undefined while we are still finding out; null when signed out. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** Raised by api.ts when any request comes back 401, so the app drops to the login page. */
export const SESSION_ENDED = "auth:session-ended";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `Something went wrong (${r.status})`;
    try {
      const j = await r.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = "Please check what you entered and try again.";
    } catch {
      /* no JSON body */
    }
    throw new Error(msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<User>) : null))
      .catch(() => null)
      .then((u) => alive && setUser(u));
    const ended = () => setUser(null);
    window.addEventListener(SESSION_ENDED, ended);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_ENDED, ended);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => setUser(await post<User>("login", { email, password })), []);
  const signup = useCallback(
    async (name: string, email: string, password: string) => setUser(await post<User>("signup", { name, email, password })),
    [],
  );
  const logout = useCallback(async () => {
    await post<void>("logout").catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, signup, logout }), [user, login, signup, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
