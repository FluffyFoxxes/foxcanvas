import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../lib/api";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          ...(mode === "register" ? { name: form.get("name") } : {}),
        }),
      });
      await refresh();
      navigate((location.state as { from?: string } | null)?.from || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen flex-col bg-[#f8f7f4] px-6">
      <header className="mx-auto flex w-full max-w-6xl items-center py-7">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-base font-semibold tracking-tight"
        >
          FoxCanvas
        </Link>
      </header>
      <section className="flex flex-1 justify-center pb-24 pt-12 sm:pt-20">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-3xl font-semibold tracking-tight">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            {mode === "login"
              ? "Enter your details to continue."
              : "Get started with FoxCanvas."}
          </p>
          <div className="mt-8 space-y-5">
            {mode === "register" && (
              <label className="block text-sm font-medium">
                Name
                <input
                  required
                  name="name"
                  maxLength={60}
                  autoComplete="name"
                  className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3.5 py-3 outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
                />
              </label>
            )}
            <label className="block text-sm font-medium">
              Email
              <input
                required
                name="email"
                type="email"
                autoComplete="email"
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3.5 py-3 outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                required
                minLength={10}
                maxLength={128}
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3.5 py-3 outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
              />
              {mode === "register" && (
                <span className="mt-2 block text-xs text-stone-500">
                  At least 10 characters
                </span>
              )}
            </label>
          </div>
          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="mt-6 w-full rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
          <p className="mt-6 text-sm text-stone-500">
            {mode === "login"
              ? "Don’t have an account?"
              : "Already have an account?"}{" "}
            <Link
              className="font-medium text-ink underline decoration-stone-400 underline-offset-4 hover:decoration-ink"
              to={mode === "login" ? "/register" : "/login"}
            >
              {mode === "login" ? "Create account" : "Sign in"}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
