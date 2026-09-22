import Image from "next/image";
import { cn } from "@/lib/utils";

/** The supplied logo files, unmodified. `reverse` is the white-on-dark lockup with the orange cue. */
export function Logo({ variant = "primary", className, height = 32 }: { variant?: "primary" | "reverse"; className?: string; height?: number }) {
  return (
    <Image
      src={variant === "reverse" ? "/brand/cuework-reverse.svg" : "/brand/cuework-primary.svg"}
      alt="Cuework"
      width={Math.round((height * 460) / 96)}
      height={height}
      unoptimized
      priority
      className={cn("h-auto select-none", className)}
      style={{ height, width: "auto" }}
    />
  );
}

export function LogoMark({ variant = "primary", size = 32, className }: { variant?: "primary" | "reverse"; size?: number; className?: string }) {
  return (
    <Image
      src={variant === "reverse" ? "/brand/cuework-mark-reverse.svg" : "/brand/cuework-mark.svg"}
      alt="Cuework"
      width={size}
      height={size}
      unoptimized
      className={cn("select-none", className)}
    />
  );
}
