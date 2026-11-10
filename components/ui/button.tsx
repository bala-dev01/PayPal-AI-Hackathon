import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "ink" | "money" | "ghost" | "danger";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 px-5 font-mono text-[0.95rem] font-bold tracking-wide " +
  "border-2 border-ink rounded-[3px] transition-[transform,box-shadow] duration-100 " +
  "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-x-0 disabled:active:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  ink: "bg-ink text-paper shadow-[3px_3px_0_var(--rule)] hover:bg-[#2c2923]",
  // PayPal blue is reserved for actions that move money.
  money: "bg-pay text-white border-pay-deep shadow-[3px_3px_0_var(--paypal-blue-deep)] hover:bg-[#0852b8]",
  ghost: "bg-transparent text-ink shadow-[3px_3px_0_var(--ink)] hover:bg-paper-deep",
  danger: "bg-transparent text-stamp border-stamp shadow-[3px_3px_0_var(--stamp-red)] hover:bg-stamp-wash",
};

export function Button({
  variant = "ink",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
