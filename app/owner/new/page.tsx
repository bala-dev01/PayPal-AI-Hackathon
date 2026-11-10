import type { Metadata } from "next";
import { NewRentalForm } from "@/components/owner/new-rental-form";
import { SiteNav } from "@/components/owner/site-nav";
import { TagLabel } from "@/components/ui";

export const metadata: Metadata = { title: "New rental | Handback" };

export default function NewRentalPage() {
  return (
    <>
      <SiteNav current="new" />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <TagLabel>Owner console</TagLabel>
        <h1 className="text-5xl sm:text-7xl">Write up a claims tag</h1>
        <p className="mt-3 max-w-[52ch] text-ink-soft">
          Describe what you are lending and what is at stake. You get one link for the renter. They authorize the
          hold; nothing is charged until the item is back and inspected.
        </p>
        <NewRentalForm />
      </div>
    </>
  );
}
