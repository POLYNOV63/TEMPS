"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { pageAutorisee, pageReglee, peut, type Droit } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";

/* ===============================================================
   GARDE D'ACCES

   Enveloppe une page et n'affiche son contenu qu'après contrôle :
     - utilisateur connecté (sinon redirection vers /login)
     - droit suffisant selon son rôle (sinon redirection vers
       /dashboard). Avec droit={null}, seule la connexion est exigée.
   DROITS_ROLES : la page doit aussi être ouverte à ce rôle dans
   Paramétrage › Droits d'accès ; une page explicitement ouverte à un
   rôle l'emporte sur le droit d'origine de la page.

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
  const chemin = usePathname() ?? "";
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

      const [{ data: moi }] = await Promise.all([
        supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle(),
        chargerDroitsRoles(),
      ]);

      if (!actif) return;

      const role = moi?.role ?? null;
      const ouverteExpres = pageReglee(role, chemin) === true;
      const ok = ouverteExpres || (pageAutorisee(role, chemin) && (!droit || peut(role, droit)));

      if (!ok) {
        router.replace(`/dashboard?refus=${encodeURIComponent(chemin)}`);
        return;
      }

      if (actif) setAutorise(true);
    }

    verifier();

    return () => {
      actif = false;
    };
  }, [droit, router, chemin]);

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
