import type { ReactNode } from "react";

/**
 * A claims tag: a main body and an optional stub separated by a perforation.
 * The stub is the tear-off part, used for the tag number and the amount.
 */
export function Ticket({
  children,
  stub,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  stub?: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  return (
    <Tag className={`ticket ${className}`}>
      <div className="p-5 sm:p-6">{children}</div>
      {stub ? (
        <>
          <div className="ticket-perf" aria-hidden="true" />
          <div className="p-5 sm:px-6">{stub}</div>
        </>
      ) : null}
    </Tag>
  );
}

/** Small typewritten caption, such as a tag number. */
export function TagLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.8125rem] text-ink-soft ${className}`}>{children}</span>;
}
