"use client";

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import ListeDevis from "@/components/pilotage/devis/ListeDevis";
import StatistiquesDevis from "@/components/pilotage/devis/StatistiquesDevis";
import { C, Message, page } from "@/components/pilotage/ui";
import { peut } from "@/lib/droits";
import { chargerMoi, type Moi } from "@/lib/pilotageDonnees";

/* ===============================================================
   PILOTAGE BE - SUIVI DES DEVIS (SUIVI_DEVIS)

   Pendant commercial du Suivi des affaires. Deux onglets :
     - Liste des devis  : ADMIN et RESPONSABLE (droit piloterBE)
     - Statistiques     : ADMIN et DIRECTION (droit indicateurs) ;
                          remplace les anciens « Indicateurs commerciaux »
   /pilotage/devis?onglet=statistiques ouvre directement les statistiques
   (l'ancienne adresse /pilotage/indicateurs y redirige).
================================================================ */

type Onglet = "liste" | "statistiques";

function SuiviDevisContenu() {
  const params = useSearchParams();
  const [moi, setMoi] = useState<Moi | null | undefined>(undefined);

  useEffect(() => {
    chargerMoi()
      .then(setMoi)
      .catch(() => setMoi(null));
  }, []);

  const voirListe = peut(moi?.role, "piloterBE");
  const voirStats = peut(moi?.role, "indicateurs");
  const demande: Onglet = params.get("onglet") === "statistiques" ? "statistiques" : "liste";
  const onglet: Onglet = demande === "statistiques" ? (voirStats ? "statistiques" : "liste") : voirListe ? "liste" : "statistiques";

  const styleOnglet = (actif: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    minHeight: 40,
    padding: "0 16px",
    borderRadius: "8px 8px 0 0",
    fontWeight: actif ? 800 : 700,
    fontSize: 15,
    textDecoration: "none",
    color: actif ? C.rougeFonce : "#3b4046",
    background: actif ? "#ffffff" : "transparent",
    border: `1px solid ${actif ? C.ligne : "transparent"}`,
    borderBottom: actif ? "3px solid #c00000" : "3px solid transparent",
  });

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="devis" />

      <div style={{ ...page.contenu, maxWidth: 1500 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={page.titre}>Suivi des devis</h1>
          <p style={page.sousTitre}>
            Les devis (DBE) du Suivi d’affaire BE : en rédaction, envoyés, à relancer, et ce qu’ils sont devenus. Le pendant commercial du Suivi des affaires.
          </p>
        </div>

        {moi === undefined && <Message genre="info">Chargement…</Message>}

        {moi !== undefined && (
          <>
            {voirListe && voirStats && (
              <nav aria-label="Onglets du suivi des devis" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.ligne}`, marginBottom: 16 }}>
                <Link href="/pilotage/devis" scroll={false} aria-current={onglet === "liste" ? "page" : undefined} style={styleOnglet(onglet === "liste")}>
                  Liste des devis
                </Link>
                <Link
                  href="/pilotage/devis?onglet=statistiques"
                  scroll={false}
                  aria-current={onglet === "statistiques" ? "page" : undefined}
                  style={styleOnglet(onglet === "statistiques")}
                >
                  Statistiques
                </Link>
              </nav>
            )}

            {onglet === "liste" && voirListe && <ListeDevis />}
            {onglet === "statistiques" && voirStats && <StatistiquesDevis />}
            {!voirListe && !voirStats && <Message genre="erreur">Votre profil ne donne pas accès au suivi des devis.</Message>}
          </>
        )}
      </div>
    </main>
  );
}

export default function SuiviDevisPage() {
  return (
    <GardeAcces droit="suiviDevis">
      <Suspense fallback={<div style={{ padding: 24, color: "#777" }}>Chargement…</div>}>
        <SuiviDevisContenu />
      </Suspense>
    </GardeAcces>
  );
}
