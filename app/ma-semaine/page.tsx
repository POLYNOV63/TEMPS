"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import MaSemaineContent from "./MaSemaineContent";
import SemaineSimplifiee from "./SemaineSimplifiee";

/* FEUILLE_SIMPLIFIEE : la feuille simplifiée (présence, absences, tickets) pour les personnes
   cochées « feuille simplifiée » dans leur fiche collaborateur (SQL 96), la feuille complète pour les autres */
function Aiguillage() {
  const params = useSearchParams();
  const collaborateur = params.get("collaborateur");
  const [simplifiee, setSimplifiee] = useState<boolean | null>(null);

  useEffect(() => {
    let actif = true;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (actif) setSimplifiee(false);
          return;
        }
        const req = supabase.from("collaborateurs").select("saisie_simplifiee");
        const { data, error } = collaborateur ? await req.eq("id", collaborateur).maybeSingle() : await req.eq("auth_user_id", user.id).maybeSingle();
        // sans le SQL 96 (colonne absente) : la feuille complète
        if (actif) setSimplifiee(!error && Boolean((data as { saisie_simplifiee?: boolean } | null)?.saisie_simplifiee));
      } catch {
        if (actif) setSimplifiee(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [collaborateur]);

  if (simplifiee === null) return <div style={{ padding: 24, fontFamily: "Calibri, Arial, sans-serif", color: "#666" }}>Chargement…</div>;
  return simplifiee ? <SemaineSimplifiee /> : <MaSemaineContent />;
}

export default function Page() {
  return (
    <Suspense fallback={<div>Chargement...</div>}>
      <Aiguillage />
    </Suspense>
  );
}
