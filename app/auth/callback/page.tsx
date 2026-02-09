"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Completing sign in...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorDesc =
      params.get("error_description") || params.get("error") || "";

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (errorDesc) {
      localStorage.removeItem("signup_provider");
      setError(errorDesc);
      return;
    }

    const handleSignedIn = async () => {
      const signupProvider = localStorage.getItem("signup_provider");
      if (signupProvider) {
        localStorage.removeItem("signup_provider");
        setStatus(
          `Sign up successful with ${signupProvider}. Redirecting to sign in...`
        );
        await supabase.auth.signOut();
        router.replace(`/sign-in?signup=${signupProvider}`);
        return;
      }
      setStatus("Signed in. Redirecting...");
      router.replace("/dashboard");
    };

    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error: exchangeError }) => {
          if (exchangeError) {
            setError(exchangeError.message);
            return;
          }
          handleSignedIn();
        })
        .catch(() => {
          setError("Unable to complete sign in. Please try again.");
        });
      return;
    }

    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        .then(({ error: sessionError }) => {
          if (sessionError) {
            setError(sessionError.message);
            return;
          }
          handleSignedIn();
        })
        .catch(() => {
          setError("Unable to complete sign in. Please try again.");
        });
      return;
    }

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        setError(sessionError.message);
        return;
      }
      if (data.session) {
        handleSignedIn();
        return;
      }
      setError("Missing auth code. Please try signing in again.");
    });
  }, [router]);

  return (
    <main className="min-h-screen bg-ink text-white flex items-center justify-center">
      <div className="card text-sm text-muted">
        {error ? `Sign-in failed: ${error}` : status}
      </div>
    </main>
  );
}
