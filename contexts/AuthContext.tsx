import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { getSupabaseClient } from "../lib/supabase/client";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isConfigured: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const handledAuthCodesRef = useRef<Set<string>>(new Set());
  const handledAuthSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const hydrateSessionFromUrl = async (url: string | null) => {
      if (!url) {
        return;
      }

      let code = "";
      let accessToken = "";
      let refreshToken = "";

      try {
        const parsedUrl = new URL(url);
        const queryParams = parsedUrl.searchParams;
        const hashParams = new URLSearchParams(
          parsedUrl.hash.replace(/^#/, "")
        );

        code =
          queryParams.get("code")?.trim() ||
          hashParams.get("code")?.trim() ||
          "";
        accessToken =
          hashParams.get("access_token")?.trim() ||
          queryParams.get("access_token")?.trim() ||
          "";
        refreshToken =
          hashParams.get("refresh_token")?.trim() ||
          queryParams.get("refresh_token")?.trim() ||
          "";
      } catch {
        return;
      }

      const sessionKey = accessToken ? `${accessToken}:${refreshToken}` : "";

      if (sessionKey && handledAuthSessionsRef.current.has(sessionKey)) {
        return;
      }

      if (accessToken && refreshToken) {
        handledAuthSessionsRef.current.add(sessionKey);

        try {
          const {
            data: { session: nextSession },
            error,
          } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            throw error;
          }

          if (!isMounted) {
            return;
          }

          setSession(nextSession);
          setUser(nextSession?.user ?? null);
          return;
        } catch {
          handledAuthSessionsRef.current.delete(sessionKey);
          return;
        }
      }

      if (!code || handledAuthCodesRef.current.has(code)) {
        return;
      }

      handledAuthCodesRef.current.add(code);

      try {
        const {
          data: { session: exchangedSession },
          error,
        } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        setSession(exchangedSession);
        setUser(exchangedSession?.user ?? null);
      } catch {
        handledAuthCodesRef.current.delete(code);
      }
    };

    const hydrate = async () => {
      await hydrateSessionFromUrl(await Linking.getInitialURL());

      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setIsLoading(false);
    };

    void hydrate();

    const urlSubscription = Linking.addEventListener("url", ({ url }) => {
      void hydrateSessionFromUrl(url);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      urlSubscription.remove();
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isLoading,
      isConfigured: Boolean(getSupabaseClient()),
      signOut: async () => {
        const supabase = getSupabaseClient();
        if (!supabase) {
          return;
        }

        await supabase.auth.signOut();
      },
    }),
    [isLoading, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
