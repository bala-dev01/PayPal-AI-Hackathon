import type { CSSProperties, ReactNode } from "react";

export type StampTone = "damage" | "clear" | "ink";

const tones: Record<StampTone, string> = {
  damage: "text-stamp",
  clear: "text-clear",
  ink: "text-ink",
};

/** A rubber stamp. Use sparingly: damage, clear, or a final verdict. */
export function Stamp({
  tone = "ink",
  tilt = -4,
  press = false,
  className = "",
  children,
}: {
  tone?: StampTone;
  tilt?: number;
  press?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const style = { "--tilt": `${tilt}deg` } as CSSProperties;
  return (
    <span className={`stamp ${press ? "stamp-press" : ""} ${tones[tone]} ${className}`} style={style}>
      {children}
    </span>
  );
}
