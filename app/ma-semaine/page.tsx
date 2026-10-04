"use client";

import { Suspense } from "react";
import MaSemaineContent from "./MaSemaineContent";

export default function Page() {
  return (
    <Suspense fallback={<div>Chargement...</div>}>
      <MaSemaineContent />
    </Suspense>
  );
}