"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* L'ancien planning par ressource est remplacé par le « Planning des affaires ». */
export default function AncienPlanningPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/pilotage/affaires");
  }, [router]);

  return null;
}
