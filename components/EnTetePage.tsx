"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { pageAutorisee } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";
import OngletsSection from "@/components/OngletsSection"; // ONGLETS_SECTION
import { page } from "@/components/pilotage/ui";

/* ===============================================================
   EN-TETE COMMUN DES PAGES POLYNOV-TEMPS

   Barre rouge unique pour toutes les pages :
     - marque POLYNOV + nom de la section
     - bouton "Précédent" (retour à la page d'où l'on vient)
     - bouton "Tableau de bord"
     - zone d'actions propre à chaque page (children)
     - titre / description optionnels

   ENTETES_HARMONISES : toutes les pages ont le MÊME en-tête que le
   Pilotage et les Finances : une barre rouge pleine largeur, collée en
   haut de l'écran, sans arrondi, quelle que soit la « forme » demandée
   (« pleine », « encadre » ou « joint », gardées pour compatibilité :
   une page posée dans un cadre avec marges voit sa barre étendue d'un
   bord à l'autre). Le titre et la description, quand la page en donne,
   s'affichent SOUS la barre (et sous le bandeau d'onglets RH / Exports),
   en noir, comme le titre des pages du Pilotage.
   DROITS_ROLES : une page fermée au rôle de la personne (Paramétrage ›
   Droits d'accès) renvoie au tableau de bord.
================================================================ */

type Forme = "pleine" | "encadre" | "joint";

type Props = {
  section: string;
  titre?: string;
  description?: string;
  forme?: Forme;
  /* Appelée avant chaque navigation ; retourner false l'annule.
     Sert à Ma semaine pour avertir d'une saisie non enregistrée. */
  avantNavigation?: () => boolean;
  children?: ReactNode;
};

export default function EnTetePage({ section, titre, description, avantNavigation, children }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLElement | null>(null);
  const chemin = usePathname() ?? "";

  /* DROITS_ROLES : une page fermée à ce rôle (Paramétrage › Droits d'accès) renvoie au tableau de bord,
     y compris pour les pages qui n'ont pas de garde d'accès */
  useEffect(() => {
    let actif = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !actif) return;
      const [{ data: moi }] = await Promise.all([supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle(), chargerDroitsRoles()]);
      if (actif && !pageAutorisee(moi?.role ?? null, chemin)) router.replace(`/dashboard?refus=${encodeURIComponent(chemin)}`);
    })();
    return () => {
      actif = false;
    };
  }, [chemin, router]);

  // la barre va d'un bord à l'autre de l'écran et touche le haut, même posée dans un cadre avec marges
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const caler = () => {
      el.style.marginLeft = "";
      el.style.width = "";
      el.style.marginTop = "";
      const r = el.getBoundingClientRect();
      const largeur = document.documentElement.clientWidth;
      const gauche = r.left + window.scrollX;
      if (gauche > 0.5 || r.width < largeur - 1) {
        el.style.marginLeft = `${-gauche}px`;
        el.style.width = `${largeur}px`;
      }
      const haut = r.top + window.scrollY;
      if (haut > 0.5 && haut < 120) el.style.marginTop = `${-haut}px`;
      // le bandeau d'onglets RH / Exports, juste dessous, suit la même largeur
      const suivant = el.nextElementSibling as HTMLElement | null;
      if (suivant?.hasAttribute("data-onglets-section")) {
        suivant.style.marginLeft = el.style.marginLeft;
        suivant.style.width = el.style.width;
      }
    };
    caler();
    window.addEventListener("resize", caler);
    return () => window.removeEventListener("resize", caler);
  }, []);

  function precedent() {
    if (avantNavigation && !avantNavigation()) return;

    // Sans historique (page ouverte directement) : retour au tableau de bord.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <>
      <header ref={ref} data-entete-page="" style={styles.header}>
        <div style={styles.ligneHaute}>
          <div style={styles.marque}>
            <span style={styles.logo}>POLYNOV</span>
            <span style={styles.separateur}>/</span>
            <span style={styles.section}>{section}</span>
          </div>

          <div style={styles.actions}>
            {children}

            <BoutonNavigation onClick={precedent}>← Précédent</BoutonNavigation>

            <BoutonNavigation
              onClick={() => {
                if (avantNavigation && !avantNavigation()) return;
                router.push("/dashboard");
              }}
            >
              ⌂ Tableau de bord
            </BoutonNavigation>
          </div>
        </div>
        <OngletsSection />
      </header>

      {titre && (
        <div style={styles.ligneTitre}>
          <h1 style={page.titre}>{titre}</h1>
          {description && <p style={page.sousTitre}>{description}</p>}
        </div>
      )}
    </>
  );
}

function BoutonNavigation({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const [survol, setSurvol] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...styles.bouton,
        background: survol ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.14)",
      }}
    >
      {children}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    background: "linear-gradient(135deg, #c00000 0%, #a80000 100%)",
    color: "white",
    padding: "16px 32px 18px",
    boxShadow: "0 3px 12px rgba(0,0,0,0.12)",
    fontFamily: "Calibri, Arial, sans-serif",
    boxSizing: "border-box",
    borderRadius: 0,
  },

  ligneHaute: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },

  marque: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },

  logo: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: 0.5,
  },

  separateur: {
    opacity: 0.55,
    fontSize: 18,
  },

  section: {
    fontSize: 16,
    fontWeight: 600,
    opacity: 0.95,
  },

  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  bouton: {
    color: "white",
    border: "1px solid rgba(255,255,255,0.40)",
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease",
  },

  // le titre de la page, sous la barre, comme sur les pages du Pilotage
  ligneTitre: {
    margin: "22px 0 18px",
    fontFamily: "Calibri, Arial, sans-serif",
  },
};
