import type { Metadata } from "next";
import { OwnerRental } from "@/components/owner/owner-rental";
import { SiteNav } from "@/components/owner/site-nav";

export const metadata: Metadata = { title: "Rental | Handback" };

export default async function OwnerRentalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteNav current="owner" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <OwnerRental id={id} />
      </div>
    </>
  );
}
