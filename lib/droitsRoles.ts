"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { definirSurcharges } from "@/lib/droits";

/* ===============================================================
   DROITS_ROLES : chargement des réglages modifiés (SQL 97)

   Lit la table polynov_droits_roles et les donne à lib/droits.ts
   (peut, pageAutorisee). Gardé en mémoire 60 secondes ; relu à chaque
   changement fait dans la page Droits d'accès. Sans le SQL 97, rien
   n'est lu : les réglages d'origine s'appliquent.
================================================================ */

let promesse: Promise<void> | null = null;
let chargeLe = 0;
let version = 0;
const abonnes = new Set<(v: number) => void>();

export function chargerDroitsRoles(forcer = false): Promise<void> {
  if (!forcer && promesse && Date.now() - chargeLe < 60000) return promesse;
  chargeLe = Date.now();
  promesse = (async () => {
    const { data, error } = await supabase.from("polynov_droits_roles").select("cle,role,autorise");
    if (error) {
      chargeLe = 0; // on réessaiera
      return;
    }
    definirSurcharges(new Map(((data ?? []) as { cle: string; role: string; autorise: boolean }[]).map((x) => [`${x.cle}|${x.role}`, Boolean(x.autorise)])));
    version += 1;
    for (const f of abonnes) f(version);
  })();
  return promesse;
}

/* pour les menus : se redessinent quand les réglages arrivent ou changent */
export function useDroitsRoles(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    abonnes.add(setV);
    void chargerDroitsRoles();
    return () => {
      abonnes.delete(setV);
    };
  }, []);
  return v;
}
