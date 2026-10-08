"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import { useRouter } from "next/navigation";
import { useState } from "react";

const authClient = createAuthClient();

export default function SignIn() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res =
        mode === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: name || email.split("@")[0] });
      if (res.error) setError(res.error.message ?? "Sign-in failed");
      else router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit} className="card auth-card">
        <h1>Aangan Studio</h1>
        <p className="muted">Enquiry dashboard — {mode === "in" ? "sign in" : "create your account"}</p>
        {mode === "up" && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={pending}>
          {pending ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
        <button type="button" className="btn link" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "First time? Create an account" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
