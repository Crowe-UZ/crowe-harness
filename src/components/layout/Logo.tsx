import { cn } from "@/lib/utils";

/** Crowe Harness mark: brand-colored tile with a stylized "C" and harness line. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("size-6 shrink-0 text-primary", className)}
      fill="none"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path
        d="M21.5 11.2a7 7 0 1 0 0 9.6"
        stroke="var(--primary-foreground)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="22.4" cy="16" r="1.9" fill="var(--primary-foreground)" />
    </svg>
  );
}
