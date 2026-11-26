import { useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, KeyRound, Server } from "lucide-react";
import { api } from "../lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<{
    aiConfigured: boolean;
    model: string | null;
  } | null>(null);
  useEffect(() => {
    void api<{ aiConfigured: boolean; model: string | null }>("/settings").then(
      setSettings,
    );
  }, []);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-semibold text-fox">Workspace</p>
      <h1 className="mt-1 text-4xl font-bold tracking-tight">Settings</h1>
      <p className="mt-3 text-stone-500">
        Configuration stays on your server—never in the browser.
      </p>
      <section className="mt-10 rounded-3xl border border-stone-200 bg-white p-7 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-100 text-fox">
            <Bot />
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">AI assistant</h2>
              {settings && (
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${settings.aiConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                >
                  {settings.aiConfigured ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <CircleAlert size={14} />
                  )}{" "}
                  {settings.aiConfigured
                    ? `Ready · ${settings.model}`
                    : "Not configured"}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">
              FoxCanvas connects to any OpenAI-compatible chat completions
              endpoint through the API server. Your provider key is never sent
              to the web client.
            </p>
          </div>
        </div>
        <div className="mt-7 grid gap-3">
          <EnvRow
            icon={<Server size={17} />}
            name="AI_BASE_URL"
            value="https://openrouter.ai/api/v1"
            optional
          />
          <EnvRow
            icon={<KeyRound size={17} />}
            name="AI_API_KEY"
            value="your provider key"
          />
          <EnvRow
            icon={<Bot size={17} />}
            name="AI_MODEL"
            value="your model name"
          />
        </div>
        <div className="mt-6 rounded-xl bg-stone-900 p-4 font-mono text-xs leading-6 text-stone-300">
          cp .env.example .env
          <br /># edit .env, then restart npm run dev
        </div>
      </section>
    </main>
  );
}
function EnvRow({
  icon,
  name,
  value,
  optional,
}: {
  icon: React.ReactNode;
  name: string;
  value: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
      <span className="text-stone-400">{icon}</span>
      <code className="text-sm font-semibold">{name}</code>
      {optional && (
        <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] uppercase text-stone-500">
          optional
        </span>
      )}
      <span className="ml-auto text-sm text-stone-400">{value}</span>
    </div>
  );
}
