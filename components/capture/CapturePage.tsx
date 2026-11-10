"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Phase } from "@/lib/types";
import { Stamp, Ticket } from "@/components/ui";
import { ErrorBlock, ItemHead, LoadingBlock, RedirectBlock, Shell } from "@/app/r/_components/shell";
import { postJson, useRental } from "@/app/r/_lib/rental";
import { NoRenterTokenNotice, useRenterToken } from "@/app/r/_lib/renter-token";
import { CaptureFlow } from "./CaptureFlow";

/** Shared page body for /pickup and /return. */
export function CapturePage({ id, phase }: { id: string; phase: Phase }) {
  const router = useRouter();
  const step = phase;
  const { data, error, loading, redirecting, reload } = useRental(id, [phase === "pickup" ? "held" : "picked_up"]);
  const renterToken = useRenterToken(id);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [pickupDone, setPickupDone] = useState(false);

  if (redirecting) return <Shell id={id} step={step}><RedirectBlock /></Shell>;
  if (loading) return <Shell id={id} step={step}><LoadingBlock /></Shell>;
  if (error || !data) return <Shell id={id} step={step}><ErrorBlock message={error ?? "Nothing came back."} onRetry={reload} /></Shell>;
  const { rental } = data;

  if (pickupDone) {
    return (
      <Shell id={id} rental={rental} step="pickup">
        <Ticket
          stub={
            <Link href={`/r/${id}/return`} className="inline-flex min-h-12 w-full items-center justify-center border-2 border-ink px-5 font-mono font-bold">
              Go to return photos
            </Link>
          }
        >
          <Stamp tone="clear" press className="mb-3 text-2xl">PICKUP LOGGED</Stamp>
          <p>Six photos of the {rental.item_name} are on file. Keep this link. When you give the item back, open it again and it will take you straight to the return photos.</p>
        </Ticket>
      </Shell>
    );
  }

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await postJson(`/api/rentals/${id}/phase`, { phase });
      if (phase === "pickup") setPickupDone(true);
      else router.push(`/r/${id}/inspection`);
    } catch (e) {
      setFinishError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Shell id={id} rental={rental} step={step}>
      <ItemHead rental={rental} kicker={phase === "pickup" ? "Condition at pickup" : "Condition at return"} />
      {renterToken === null ? <NoRenterTokenNotice /> : null}
      <CaptureFlow
        rentalId={id}
        phase={phase}
        photos={data.photos}
        itemName={rental.item_name}
        finishing={finishing}
        finishError={finishError}
        onFinish={finish}
      />
    </Shell>
  );
}
