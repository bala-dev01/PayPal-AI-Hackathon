import Link from "next/link";

export function SiteNav({ current }: { current?: "home" | "owner" | "new" }) {
  const link = (active: boolean) =>
    `inline-flex min-h-11 items-center border-b-2 px-1 font-mono text-[0.9rem] font-bold ${
      active ? "border-ink" : "border-transparent hover:border-rule"
    }`;
  return (
    <header className="border-b-2 border-ink">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 px-4 sm:px-6">
        <Link href="/" className="flex min-h-12 items-center gap-2 font-display text-3xl leading-none">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-ink bg-paper" />
          Handback
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/owner" className={link(current === "owner")} aria-current={current === "owner" ? "page" : undefined}>
            Console
          </Link>
          <Link href="/owner/new" className={link(current === "new")} aria-current={current === "new" ? "page" : undefined}>
            New rental
          </Link>
        </div>
      </nav>
    </header>
  );
}
