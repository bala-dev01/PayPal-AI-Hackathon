import type { Metadata } from "next";
import { Ledger } from "@/components/owner/ledger";
import { LinkButton } from "@/components/owner/link-button";
import { SiteNav } from "@/components/owner/site-nav";
import { TagLabel } from "@/components/ui";

export const metadata: Metadata = { title: "Ledger | Handback" };

export default function OwnerPage() {
  return (
    <>
      <SiteNav current="owner" />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <TagLabel>Owner console</TagLabel>
            <h1 className="text-5xl sm:text-7xl">The ledger</h1>
          </div>
          <LinkButton href="/owner/new">Create a rental</LinkButton>
        </div>
        <Ledger />
      </div>
    </>
  );
}
