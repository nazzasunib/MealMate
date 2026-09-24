"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import JoinFlow from "@/components/JoinFlow";
import Splash from "@/components/Splash";

function Inner() {
  const params = useSearchParams();
  return <JoinFlow initialCode={params.get("code") || ""} />;
}

export default function JoinPage() {
  return (
    <Suspense fallback={<Splash label="Just a moment…" />}>
      <Inner />
    </Suspense>
  );
}
