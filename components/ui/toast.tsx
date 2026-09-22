"use client";

import { CircleCheck, TriangleAlert, X } from "lucide-react";
import * as React from "react";

type Toast = { id: number; tone: "success" | "error"; message: string };
const Ctx = React.createContext<{ success: (m: string) => void; error: (m: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const next = React.useRef(1);

  const push = React.useCallback((tone: Toast["tone"], message: string) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, tone, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4500);
  }, []);

  const api = React.useMemo(() => ({ success: (m: string) => push("success", m), error: (m: string) => push("error", m) }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-md animate-toast items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-pop"
          >
            {t.tone === "success" ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-[#7fd0a8]" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-cue" aria-hidden />
            )}
            <p className="flex-1 leading-snug">{t.message}</p>
            <button
              aria-label="Dismiss"
              className="-mr-1 rounded p-0.5 text-side-muted hover:text-white"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
