"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, page } from "@/components/pilotage/ui";
import { calculerNewsletter, chargerNewsletter, type DonneesNewsletter, type Newsletter } from "@/lib/newsletter";

/* ===============================================================
   ANALYSE - NEWSLETTER DU MOIS (NEWSLETTER, PLG, 20/11/2026)
   L'image mensuelle pour l'équipe : le mois en chiffres et les affaires en
   cours, avec les montants (droit « indicateurs »). L'image est un SVG
   dessiné ici (1080 × 1350, format portrait), téléchargeable en PNG.
   Chiffres : lib/newsletter.ts.
================================================================ */

const LARGEUR = 1080;
const HAUTEUR = 1350;
const NB_AFFAIRES = 8;
const ROUGE = "#c00000";
const ENCRE = "#1f2328";
const GRIS = "#5b6168";
const POLICE = "Calibri, 'Segoe UI', Arial, sans-serif";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const keur = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000).toLocaleString("fr-FR")} k€` : `${Math.round(v).toLocaleString("fr-FR")} €`);
const dateFR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—");
const couper = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const decaler = (m: string, k: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};

function ImageNewsletter({ n, refSvg }: { n: Newsletter; refSvg: React.Ref<SVGSVGElement> }) {
  const tuiles = [
    { titre: "Commandes reçues", valeur: String(n.commandes.nombre), sous: keur(n.commandes.montant), couleur: "#1b5e20" },
    { titre: "Affaires livrées", valeur: String(n.livrees.nombre), sous: keur(n.livrees.montant), couleur: "#34506b" },
    { titre: "CA facturé", valeur: keur(n.ca), sous: "forfaits livrés + PE / PI", couleur: ROUGE },
    { titre: "Devis ouverts", valeur: String(n.devis), sous: "nouveaux chiffrages", couleur: "#6b58a8" },
  ];
  const affaires = n.enCours.slice(0, NB_AFFAIRES);
  const yListe = 560;
  const hLigne = 88;
  const larg = LARGEUR - 120;
  const xBarre = 640;
  const lBarre = 250;
  const aujourdhui = new Date().toLocaleDateString("fr-FR");

  return (
    <svg ref={refSvg} xmlns="http://www.w3.org/2000/svg" width={LARGEUR} height={HAUTEUR} viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} fontFamily={POLICE} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect width={LARGEUR} height={HAUTEUR} fill="#f6f7f9" />

      {/* bandeau */}
      <rect width={LARGEUR} height={190} fill={ROUGE} />
      <text x={60} y={78} fill="#ffffff" fontSize={26} fontWeight={700} letterSpacing={4}>
        POLYNOV · LE POINT DU MOIS
      </text>
      <text x={60} y={146} fill="#ffffff" fontSize={64} fontWeight={800}>
        {libMois(n.mois).replace(/^./, (c) => c.toUpperCase())}
      </text>

      {/* le mois en chiffres */}
      <text x={60} y={262} fill={ENCRE} fontSize={30} fontWeight={800}>
        Le mois en chiffres
      </text>
      {tuiles.map((t, i) => {
        const w = (larg - 3 * 20) / 4;
        const x = 60 + i * (w + 20);
        return (
          <g key={t.titre}>
            <rect x={x} y={290} width={w} height={190} rx={18} fill="#ffffff" stroke="#e3e6ea" />
            <rect x={x} y={290} width={w} height={8} rx={4} fill={t.couleur} />
            <text x={x + 22} y={340} fill={GRIS} fontSize={21} fontWeight={700}>
              {t.titre}
            </text>
            <text x={x + 22} y={412} fill={t.couleur} fontSize={t.valeur.length > 7 ? 46 : 58} fontWeight={800}>
              {t.valeur}
            </text>
            <text x={x + 22} y={452} fill={GRIS} fontSize={20}>
              {t.sous}
            </text>
          </g>
        );
      })}

      {/* affaires en cours */}
      <text x={60} y={yListe - 22} fill={ENCRE} fontSize={30} fontWeight={800}>
        Affaires en cours
      </text>
      <text x={LARGEUR - 60} y={yListe - 22} fill={GRIS} fontSize={21} textAnchor="end">
        {n.nbEnCours} affaires · {keur(n.montantEnCours)} en commande
      </text>
      <rect x={60} y={yListe} width={larg} height={affaires.length * hLigne + 56} rx={18} fill="#ffffff" stroke="#e3e6ea" />
      <text x={90} y={yListe + 38} fill={GRIS} fontSize={18} fontWeight={700}>
        AFFAIRE
      </text>
      <text x={xBarre - 30} y={yListe + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
        COMMANDÉ
      </text>
      <text x={xBarre} y={yListe + 38} fill={GRIS} fontSize={18} fontWeight={700}>
        AVANCEMENT
      </text>
      <text x={LARGEUR - 90} y={yListe + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
        LIVRAISON
      </text>
      {affaires.map((a, i) => {
        const y = yListe + 56 + i * hLigne;
        const pc = a.avancement === null ? null : Math.round(a.avancement * 100);
        const plein = a.avancement === null ? 0 : Math.min(1, a.avancement);
        const couleur = pc === null ? "#c9ced6" : pc > 100 ? "#b3261e" : pc >= 80 ? "#e08a1e" : "#2e7d32";
        return (
          <g key={a.base}>
            {i > 0 && <line x1={90} x2={LARGEUR - 90} y1={y} y2={y} stroke="#eceef1" />}
            <text x={90} y={y + 36} fill={ENCRE} fontSize={23} fontWeight={800}>
              {couper(`${a.client ? `${a.client} · ` : ""}CBE ${a.base}`, 34)}
            </text>
            <text x={90} y={y + 66} fill={GRIS} fontSize={19}>
              {couper(a.designation, 44)}
            </text>
            <text x={xBarre - 30} y={y + 50} fill={ENCRE} fontSize={23} fontWeight={700} textAnchor="end">
              {keur(a.montant)}
            </text>
            <rect x={xBarre} y={y + 32} width={lBarre} height={20} rx={10} fill="#eef0f3" />
            <rect x={xBarre} y={y + 32} width={Math.max(plein > 0 ? 20 : 0, lBarre * plein)} height={20} rx={10} fill={couleur} />
            <text x={xBarre + lBarre + 12} y={y + 49} fill={couleur} fontSize={21} fontWeight={800}>
              {pc === null ? "—" : `${pc} %`}
            </text>
            <text x={LARGEUR - 90} y={y + 50} fill={ENCRE} fontSize={21} textAnchor="end">
              {dateFR(a.livraison)}
            </text>
          </g>
        );
      })}

      {/* pied */}
      <text x={60} y={HAUTEUR - 40} fill={GRIS} fontSize={18}>
        Avancement = heures pointées ÷ heures chiffrées (commande et avenants). Chiffres POLYNOV-TEMPS au {aujourdhui}.
      </text>
    </svg>
  );
}

function NewsletterContenu() {
  const [donnees, setDonnees] = useState<DonneesNewsletter | null>(null);
  const [erreur, setErreur] = useState("");
  const [mois, setMois] = useState(() => decaler(new Date().toISOString().slice(0, 7), -1)); // le mois écoulé
  const [export_, setExport] = useState(false);
  const refSvg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let actif = true;
    chargerNewsletter()
      .then((d) => actif && setDonnees(d))
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      actif = false;
    };
  }, []);

  const n = useMemo(() => (donnees ? calculerNewsletter(donnees, mois) : null), [donnees, mois]);

  async function telecharger() {
    const svg = refSvg.current;
    if (!svg) return;
    setExport(true);
    try {
      const texte = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([texte], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise<void>((ok, ko) => {
        img.onload = () => ok();
        img.onerror = () => ko(new Error("Image illisible"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = LARGEUR * 2;
      canvas.height = HAUTEUR * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Dessin impossible");
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, LARGEUR, HAUTEUR);
      URL.revokeObjectURL(url);
      const png = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = png;
      a.download = `Newsletter_POLYNOV_${mois}.png`;
      a.click();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setExport(false);
    }
  }

  const btn: CSSProperties = { minHeight: 38, minWidth: 38, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: "0 12px" };

  return (
    <div style={{ ...page.contenu, maxWidth: 1000 }}>
      <h1 style={page.titre}>Newsletter du mois</h1>
      <p style={page.sousTitre}>L’image du mois pour l’équipe : le mois en chiffres et les affaires en cours. Choisissez le mois, puis téléchargez l’image.</p>
      <div style={{ ...page.carte, padding: 12, margin: "14px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, -1))} aria-label="Mois précédent">
          ◀
        </button>
        <strong style={{ minWidth: 150, textAlign: "center" }}>{libMois(mois)}</strong>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, 1))} aria-label="Mois suivant">
          ▶
        </button>
        <button type="button" style={{ ...btn, marginLeft: "auto", background: C.rouge, color: "#ffffff", border: "none" }} disabled={!n || export_} onClick={() => void telecharger()}>
          {export_ ? "Préparation…" : "⬇ Télécharger l’image (PNG)"}
        </button>
      </div>
      {erreur && <p style={{ color: C.rougeTexte }}>{erreur}</p>}
      {!n && !erreur && <p style={{ color: C.gris }}>Lecture des chiffres…</p>}
      {n && (
        <div style={{ ...page.carte, padding: 0, overflow: "hidden" }}>
          <ImageNewsletter n={n} refSvg={refSvg} />
        </div>
      )}
      {n && n.enCours.length > NB_AFFAIRES && (
        <p style={{ fontSize: 13, color: C.gris }}>
          L’image montre les {NB_AFFAIRES} affaires en cours au plus gros montant commandé, sur {n.nbEnCours}.
        </p>
      )}
    </div>
  );
}

export default function PageNewsletter() {
  return (
    <GardeAcces droit="indicateurs">
      <main style={page.fond}>
        <EnTetePage section="Analyse" />
        <NewsletterContenu />
      </main>
    </GardeAcces>
  );
}
