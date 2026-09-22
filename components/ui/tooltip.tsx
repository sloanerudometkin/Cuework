"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

/**
 * Deliberately does NOT use `asChild`: children often come from Server Components, and React may
 * deliver large payloads to a client component as lazy nodes that Radix's Slot can't attach to
 * (that crashed the Performance page). The trigger renders its own focusable button instead.
 */
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger type="button" className="inline-flex cursor-help rounded-full align-middle">
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-[60] max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-snug text-white shadow-pop animate-fade"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
