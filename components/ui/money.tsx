import { formatCents } from "@/lib/pricing";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "$", AUD: "$" };

/** Integer cents in, typewritten amount out. Tabular so columns line up. */
export function Money({
  cents,
  currency = "USD",
  tone = "ink",
  size = "md",
  className = "",
}: {
  cents: number;
  currency?: string;
  tone?: "ink" | "damage" | "clear" | "muted";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const toneClass = { ink: "text-ink", damage: "text-stamp", clear: "text-clear", muted: "text-ink-soft" }[tone];
  const sizeClass = { sm: "text-sm", md: "text-lg", lg: "text-4xl sm:text-5xl" }[size];
  const symbol = SYMBOLS[currency] ?? "";
  const [whole = "0", frac = "00"] = formatCents(Math.abs(cents)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <span
      className={`font-mono font-bold tabular-nums ${toneClass} ${sizeClass} ${className}`}
      aria-label={`${cents < 0 ? "minus " : ""}${grouped}.${frac} ${currency}`}
    >
      {cents < 0 ? "-" : ""}
      {symbol}
      {grouped}.{frac}
    </span>
  );
}
