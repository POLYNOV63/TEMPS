"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { peut, type Droit } from "@/lib/droits";

/* ===============================================================
   GARDE D'ACCES

   Enveloppe une page et n'affiche son contenu qu'après contrôle :
     - utilisateur connecté (sinon redirection vers /login)
     - droit suffisant selon son rôle (sinon redirection vers
       /dashboard). Avec droit={null}, seule la connexion est exigée.

   Le contenu n'est monté qu'une fois l'accès validé : ses
   chargements de données ne démarrent donc pas avant le contrôle.

   Ce contrôle est un confort d'affichage. La protection réelle des
   données reste assurée par les policies RLS de Supabase.
================================================================ */

export default function GardeAcces({
  droit,
  children,
}: {
  droit: Droit | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [autorise, setAutorise] = useState(false);

  useEffect(() => {
    let actif = true;

    async function verifier() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      if (droit) {
        const { data: moi } = await supabase
          .from("collaborateurs")
          .select("role")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (!actif) return;

        if (!peut(moi?.role, droit)) {
          router.replace("/dashboard");
          return;
        }
      }

      if (actif) setAutorise(true);
    }

    verifier();

    return () => {
      actif = false;
    };
  }, [droit, router]);

  if (!autorise) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Calibri, Arial, sans-serif",
          color: "#777",
          fontSize: 15,
        }}
      >
        Vérification des accès…
      </div>
    );
  }

  return <>{children}</>;
}
