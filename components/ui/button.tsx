import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,box-shadow,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px select-none",
  {
    variants: {
      variant: {
        // Ink is the default "do it" colour.
        primary: "bg-ink text-white hover:bg-ink-3 shadow-card",
        // The cue: reserved for the single most important commitment on a screen.
        cue: "bg-cue-700 text-white hover:bg-[#9c440a] shadow-card",
        secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken shadow-card",
        ghost: "text-soft hover:bg-sunken hover:text-ink",
        danger: "bg-surface text-brick border border-line-strong hover:bg-brick-soft",
        onDark: "bg-white/10 text-white hover:bg-white/15 border border-white/15",
      },
      size: {
        sm: "h-8 px-3 text-[14.56px]",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-[16.8px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
