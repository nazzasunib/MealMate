"use client";
import { useParams } from "next/navigation";
import JoinFlow from "@/components/JoinFlow";

export default function JoinWithCodePage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code || ""));
  return <JoinFlow initialCode={code} />;
}
