"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions/types";

/** Runs a server action inside a transition, toasts the outcome, and refreshes server data. */
export function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = React.useTransition();

  const run = React.useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | ((data: T) => string); onOk?: (data: T) => void; onError?: (message: string) => void } = {}) => {
      start(async () => {
        const result = await fn();
        if (result.ok) {
          if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(result.data) : opts.success);
          opts.onOk?.(result.data);
          router.refresh();
        } else {
          toast.error(result.error);
          opts.onError?.(result.error);
        }
      });
    },
    [router, toast],
  );

  return { run, pending };
}
