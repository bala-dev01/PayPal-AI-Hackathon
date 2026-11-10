"use client";

import { useParams } from "next/navigation";
import { CapturePage } from "@/components/capture/CapturePage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CapturePage id={id} phase="return" />;
}
