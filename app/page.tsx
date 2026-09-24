"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Splash from "@/components/Splash";
import { useSessionUser } from "@/lib/useSession";

export default function Home() {
  const router = useRouter();
  const { status } = useSessionUser();
  useEffect(() => {
    if (status === "in") router.replace("/app");
    if (status === "out") router.replace("/login");
  }, [status, router]);
  return <Splash label="Opening MealMate…" />;
}
