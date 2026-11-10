import Link from "next/link";
import type { ReactNode } from "react";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 px-5 font-mono text-[0.95rem] font-bold tracking-wide " +
  "border-2 rounded-[3px] transition-[transform,box-shadow] duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

const variants = {
  ink: "border-ink bg-ink text-paper shadow-[3px_3px_0_var(--rule)] hover:bg-[#2c2923]",
  ghost: "border-ink bg-transparent text-ink shadow-[3px_3px_0_var(--ink)] hover:bg-paper-deep",
  paper: "border-paper bg-paper text-ink shadow-[3px_3px_0_var(--rule)] hover:bg-card",
  outlinePaper: "border-paper bg-transparent text-paper shadow-[3px_3px_0_var(--rule)] hover:bg-[#2c2923]",
};

/** A link styled like Button. Navigation, not an action. */
export function LinkButton({
  href,
  variant = "ink",
  children,
  className = "",
}: {
  href: string;
  variant?: keyof typeof variants;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
