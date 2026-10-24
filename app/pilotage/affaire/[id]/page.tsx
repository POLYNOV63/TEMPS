"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   ANCIENNE FICHE D'UNE AFFAIRE -> BILAN AFFAIRE

   La fiche et le Bilan affaire ne font plus qu'une page : tous les liens
   vers /pilotage/affaire/<id> (portefeuille, planning, anciens favoris)
   arrivent ici et repartent vers le Bilan affaire, sur la bonne commande
   (base ou avenant). Le Bilan affaire porte désormais le panneau
   « Pilotage » : responsable, délai et son historique, affectations.
================================================================ */

function RedirectionContenu() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    const id = String(params?.id ?? "");
    supabase
      .from("pilotage_affaires")
      .select("type,numero")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setErreur("Affaire introuvable.");
          return;
        }
        const a = data as { type: string; numero: string };
        const base = a.numero.match(/^\d+/)?.[0] ?? a.numero;
        router.replace(`/affaires/bilan?affaire=${a.type}${base}&commande=${encodeURIComponent(a.numero)}`);
      });
  }, [params, router]);

  return (
    <main style={page.fond}>
      <EnTetePage section="Bilan affaire" />
      <div style={page.contenu}>{erreur ? <Message genre="erreur">{erreur}</Message> : <Message genre="info">Ouverture du bilan de l’affaire…</Message>}</div>
    </main>
  );
}

export default function FichePage() {
  return (
    <GardeAcces droit="piloterBE">
      <RedirectionContenu />
    </GardeAcces>
  );
}
