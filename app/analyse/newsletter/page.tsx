"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, page } from "@/components/pilotage/ui";
import { COULEURS_PE, COULEURS_PI, couleurMetier } from "@/lib/couleurs";
import { useDisponibilitesActivites } from "@/lib/disponibilitesActivites";
import { aISO, lundiDe, numeroSemaine } from "@/lib/pilotagePlanning";
import { calculerNewsletter, chargerNewsletter, type DonneesNewsletter, type Delai, type Newsletter } from "@/lib/newsletter";

/* ===============================================================
   ANALYSE - NEWSLETTER DU MOIS (NEWSLETTER, PLG, 20/11/2026)
   L'image mensuelle pour l'équipe : le mois en chiffres et les affaires en
   cours, avec les montants (droit « indicateurs »). L'image est un SVG
   dessiné ici (1080 de large), téléchargeable en PNG.
   Chiffres : lib/newsletter.ts.
   NEWSLETTER_V2 (20/11/2026) : activités en cours, charge des 8 prochaines
   semaines (Méca, Elec, Calcul, comme les Disponibilités par activité),
   équipe et activités de chaque affaire, délai (retard, décalage), et les
   prestations PE / PI. La hauteur de l'image suit son contenu.
================================================================ */

const LARGEUR = 1080;
const NB_AFFAIRES = 8;
const NB_PRESTATIONS = 8;
const NB_SEMAINES = 8;
const ROUGE = "#c00000";
const ENCRE = "#1f2328";
const GRIS = "#5b6168";
const VERT = "#2e7d32";
const ORANGE = "#e08a1e";
const ROUGE_ALERTE = "#b3261e";
const POLICE = "Calibri, 'Segoe UI', Arial, sans-serif";
const MARGE = 60;
const LARG = LARGEUR - 2 * MARGE;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const keur = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000).toLocaleString("fr-FR")} k€` : `${Math.round(v).toLocaleString("fr-FR")} €`);
const heures = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} h`;
const dateFR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—");
const couper = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const decaler = (m: string, k: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const equipeTexte = (e: string[], n: number) => (e.length === 0 ? "personne au planning" : couper(e.slice(0, 5).join(", ") + (e.length > 5 ? ` +${e.length - 5}` : ""), n));
const couleurCharge = (pc: number | null) => (pc === null ? "#eef0f3" : pc > 100 ? ROUGE_ALERTE : pc >= 85 ? ORANGE : pc >= 50 ? VERT : "#9ccc9f");

/* la ligne « délai » sous la date de livraison */
function libDelai(d: Delai): { texte: string; couleur: string } {
  if (!d.livraison) return { texte: "non datée", couleur: GRIS };
  if (d.retard > 0) return { texte: `en retard de ${d.retard} j`, couleur: ROUGE_ALERTE };
  if (d.decalage > 0) return { texte: `décalée de ${d.decalage} j`, couleur: ORANGE };
  return { texte: "dans les temps", couleur: VERT };
}

type ChargeActivite = { libelle: string; couleur: string; pc: (number | null)[] };

function Titre({ y, texte, droite }: { y: number; texte: string; droite?: string }) {
  return (
    <g>
      <text x={MARGE} y={y} fill={ENCRE} fontSize={30} fontWeight={800}>
        {texte}
      </text>
      {droite && (
        <text x={LARGEUR - MARGE} y={y} fill={GRIS} fontSize={21} textAnchor="end">
          {droite}
        </text>
      )}
    </g>
  );
}

function Pastille({ x, y, groupe }: { x: number; y: number; groupe: string }) {
  return (
    <g>
      <circle cx={x + 11} cy={y} r={11} fill={couleurMetier(groupe)} />
      <text x={x + 11} y={y + 5} fill="#ffffff" fontSize={13} fontWeight={800} textAnchor="middle">
        {groupe.charAt(0).toUpperCase()}
      </text>
    </g>
  );
}

function ImageNewsletter({ n, charge, semaines, refSvg }: { n: Newsletter; charge: ChargeActivite[]; semaines: string[]; refSvg: React.Ref<SVGSVGElement> }) {
  const aujourdhui = new Date().toLocaleDateString("fr-FR");
  const blocs: ReactNode[] = [];
  let y = 0;

  /* bandeau */
  blocs.push(
    <g key="bandeau">
      <rect width={LARGEUR} height={190} fill={ROUGE} />
      <text x={MARGE} y={78} fill="#ffffff" fontSize={26} fontWeight={700} letterSpacing={4}>
        POLYNOV · LE POINT DU MOIS
      </text>
      <text x={MARGE} y={146} fill="#ffffff" fontSize={64} fontWeight={800}>
        {libMois(n.mois).replace(/^./, (c) => c.toUpperCase())}
      </text>
    </g>
  );
  y = 262;

  /* le mois en chiffres */
  const tuiles = [
    { titre: "Commandes reçues", valeur: String(n.commandes.nombre), sous: keur(n.commandes.montant), couleur: "#1b5e20" },
    { titre: "Affaires livrées", valeur: String(n.livrees.nombre), sous: keur(n.livrees.montant), couleur: "#34506b" },
    { titre: "CA facturé", valeur: keur(n.ca), sous: "forfaits livrés + PE / PI", couleur: ROUGE },
    { titre: "Devis ouverts", valeur: String(n.devis), sous: "nouveaux chiffrages", couleur: "#6b58a8" },
  ];
  blocs.push(<Titre key="t-chiffres" y={y} texte="Le mois en chiffres" />);
  {
    const y0 = y + 28;
    const w = (LARG - 3 * 20) / 4;
    blocs.push(
      <g key="tuiles">
        {tuiles.map((t, i) => {
          const x = MARGE + i * (w + 20);
          return (
            <g key={t.titre}>
              <rect x={x} y={y0} width={w} height={190} rx={18} fill="#ffffff" stroke="#e3e6ea" />
              <rect x={x} y={y0} width={w} height={8} rx={4} fill={t.couleur} />
              <text x={x + 22} y={y0 + 50} fill={GRIS} fontSize={21} fontWeight={700}>
                {t.titre}
              </text>
              <text x={x + 22} y={y0 + 122} fill={t.couleur} fontSize={t.valeur.length > 7 ? 46 : 58} fontWeight={800}>
                {t.valeur}
              </text>
              <text x={x + 22} y={y0 + 162} fill={GRIS} fontSize={20}>
                {t.sous}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + 190 + 80;
  }

  /* les activités : affaires en cours, reste à faire */
  if (n.parActivite.length > 0) {
    blocs.push(<Titre key="t-act" y={y} texte="Les activités" droite="affaires en cours au forfait" />);
    const y0 = y + 28;
    const k = n.parActivite.length;
    const w = (LARG - (k - 1) * 20) / k;
    blocs.push(
      <g key="activites">
        {n.parActivite.map((a, i) => {
          const x = MARGE + i * (w + 20);
          const coul = couleurMetier(a.groupe);
          const pc = a.chiffre > 0.5 ? Math.round((a.pointe / a.chiffre) * 100) : null;
          return (
            <g key={a.groupe}>
              <rect x={x} y={y0} width={w} height={170} rx={18} fill="#ffffff" stroke="#e3e6ea" />
              <rect x={x} y={y0} width={8} height={170} rx={4} fill={coul} />
              <text x={x + 26} y={y0 + 44} fill={coul} fontSize={26} fontWeight={800}>
                {a.groupe}
              </text>
              <text x={x + 26} y={y0 + 96} fill={ENCRE} fontSize={40} fontWeight={800}>
                {a.nb}
                <tspan fontSize={21} fontWeight={600} fill={GRIS}>
                  {a.nb > 1 ? " affaires" : " affaire"}
                </tspan>
              </text>
              <text x={x + 26} y={y0 + 130} fill={GRIS} fontSize={19}>
                {heures(a.reste)} restant à faire
              </text>
              <text x={x + 26} y={y0 + 156} fill={GRIS} fontSize={19}>
                {pc === null ? "" : `${pc} % du chiffré pointé`}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + 170 + 80;
  }

  /* la charge des 8 prochaines semaines */
  if (charge.length > 0 && semaines.length > 0) {
    blocs.push(<Titre key="t-charge" y={y} texte="La charge à venir" droite="heures planifiées ÷ capacité, par semaine" />);
    const y0 = y + 30;
    const xCases = MARGE + 170;
    const lCase = (LARGEUR - MARGE - 20 - xCases - (semaines.length - 1) * 8) / semaines.length;
    const hCadre = 46 + charge.length * 62 + 14;
    blocs.push(
      <g key="charge">
        <rect x={MARGE} y={y0} width={LARG} height={hCadre} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        {semaines.map((l, w) => (
          <text key={l} x={xCases + w * (lCase + 8) + lCase / 2} y={y0 + 34} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="middle">
            S{numeroSemaine(l)}
          </text>
        ))}
        {charge.map((a, i) => {
          const yy = y0 + 46 + i * 62;
          return (
            <g key={a.libelle}>
              <circle cx={MARGE + 34} cy={yy + 27} r={9} fill={a.couleur} />
              <text x={MARGE + 52} y={yy + 35} fill={ENCRE} fontSize={23} fontWeight={800}>
                {a.libelle}
              </text>
              {a.pc.map((pc, w) => {
                const x = xCases + w * (lCase + 8);
                return (
                  <g key={w}>
                    <rect x={x} y={yy + 4} width={lCase} height={46} rx={10} fill={couleurCharge(pc)} />
                    <text x={x + lCase / 2} y={yy + 35} fill={pc === null ? GRIS : "#ffffff"} fontSize={20} fontWeight={800} textAnchor="middle">
                      {pc === null ? "—" : `${pc} %`}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    );
    y = y0 + hCadre + 34;
    blocs.push(
      <text key="legende-charge" x={MARGE} y={y} fill={GRIS} fontSize={17}>
        Vert clair : de la place · vert : bien chargé · orange : 85 % et plus · rouge : surcharge (plus de 100 %).
      </text>
    );
    y += 76;
  }

  /* les affaires en cours */
  {
    const affaires = n.enCours.slice(0, NB_AFFAIRES);
    const hLigne = 118;
    const xBarre = 610;
    const lBarre = 210;
    blocs.push(
      <Titre
        key="t-encours"
        y={y}
        texte="Affaires en cours"
        droite={`${n.nbEnCours} affaires · ${keur(n.montantEnCours)} en commande${n.nbRetard > 0 ? ` · ${n.nbRetard} en retard` : ""}`}
      />
    );
    const y0 = y + 22;
    blocs.push(
      <g key="encours">
        <rect x={MARGE} y={y0} width={LARG} height={affaires.length * hLigne + 56} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        <text x={90} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700}>
          AFFAIRE · ÉQUIPE
        </text>
        <text x={xBarre - 24} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
          COMMANDÉ
        </text>
        <text x={xBarre} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700}>
          AVANCEMENT
        </text>
        <text x={LARGEUR - 90} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
          LIVRAISON
        </text>
        {affaires.map((a, i) => {
          const yy = y0 + 56 + i * hLigne;
          const pc = a.avancement === null ? null : Math.round(a.avancement * 100);
          const plein = a.avancement === null ? 0 : Math.min(1, a.avancement);
          const couleur = pc === null ? "#c9ced6" : pc > 100 ? ROUGE_ALERTE : pc >= 80 ? ORANGE : VERT;
          const dl = libDelai(a);
          const xEquipe = 90 + a.activites.length * 26 + (a.activites.length ? 8 : 0);
          return (
            <g key={a.base}>
              {i > 0 && <line x1={90} x2={LARGEUR - 90} y1={yy} y2={yy} stroke="#eceef1" />}
              <text x={90} y={yy + 34} fill={ENCRE} fontSize={23} fontWeight={800}>
                {couper(`${a.client ? `${a.client} · ` : ""}CBE ${a.base}`, 32)}
              </text>
              <text x={90} y={yy + 62} fill={GRIS} fontSize={19}>
                {couper(a.designation, 42)}
              </text>
              {a.activites.map((x, k) => (
                <Pastille key={x.groupe} x={90 + k * 26} y={yy + 89} groupe={x.groupe} />
              ))}
              <text x={xEquipe} y={yy + 95} fill={a.equipe.length ? ENCRE : "#9aa0a6"} fontSize={18} fontStyle={a.equipe.length ? undefined : "italic"}>
                {equipeTexte(a.equipe, 44 - a.activites.length * 3)}
              </text>
              <text x={xBarre - 24} y={yy + 48} fill={ENCRE} fontSize={23} fontWeight={700} textAnchor="end">
                {keur(a.montant)}
              </text>
              <rect x={xBarre} y={yy + 30} width={lBarre} height={20} rx={10} fill="#eef0f3" />
              <rect x={xBarre} y={yy + 30} width={Math.max(plein > 0 ? 20 : 0, lBarre * plein)} height={20} rx={10} fill={couleur} />
              <text x={xBarre + lBarre + 12} y={yy + 47} fill={couleur} fontSize={21} fontWeight={800}>
                {pc === null ? "—" : `${pc} %`}
              </text>
              <text x={xBarre} y={yy + 80} fill={GRIS} fontSize={17}>
                {a.chiffre > 0.5 ? `${heures(a.pointe)} / ${heures(a.chiffre)}` : ""}
              </text>
              <text x={LARGEUR - 90} y={yy + 46} fill={ENCRE} fontSize={21} fontWeight={700} textAnchor="end">
                {dateFR(a.livraison)}
              </text>
              <text x={LARGEUR - 90} y={yy + 74} fill={dl.couleur} fontSize={17} fontWeight={700} textAnchor="end">
                {dl.texte}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + affaires.length * hLigne + 56 + 80;
  }

  /* les prestations PE / PI */
  if (n.prestations.length > 0) {
    const prestations = n.prestations.slice(0, NB_PRESTATIONS);
    const hLigne = 104;
    const nbPE = n.prestations.filter((p) => p.imputation === "PE").length;
    blocs.push(
      <Titre
        key="t-pepi"
        y={y}
        texte="Prestations PE / PI"
        droite={`${nbPE} PE · ${n.prestations.length - nbPE} PI · ${keur(n.caPrestationsMois)} facturés dans le mois`}
      />
    );
    const y0 = y + 22;
    blocs.push(
      <g key="pepi">
        <rect x={MARGE} y={y0} width={LARG} height={prestations.length * hLigne + 56} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        <text x={90} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700}>
          PRESTATION · ÉQUIPE
        </text>
        <text x={760} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
          FACTURÉ DU MOIS
        </text>
        <text x={LARGEUR - 90} y={y0 + 38} fill={GRIS} fontSize={18} fontWeight={700} textAnchor="end">
          FIN PRÉVUE
        </text>
        {prestations.map((p, i) => {
          const yy = y0 + 56 + i * hLigne;
          const coul = p.imputation === "PE" ? COULEURS_PE.fond : COULEURS_PI.fond;
          return (
            <g key={p.base}>
              {i > 0 && <line x1={90} x2={LARGEUR - 90} y1={yy} y2={yy} stroke="#eceef1" />}
              <rect x={90} y={yy + 14} width={44} height={26} rx={6} fill={coul} />
              <text x={112} y={yy + 33} fill="#ffffff" fontSize={16} fontWeight={800} textAnchor="middle">
                {p.imputation}
              </text>
              <text x={146} y={yy + 34} fill={ENCRE} fontSize={23} fontWeight={800}>
                {couper(`${p.client ? `${p.client} · ` : ""}CBE ${p.base}`, 34)}
              </text>
              <text x={90} y={yy + 62} fill={GRIS} fontSize={19}>
                {couper(p.designation, 52)}
              </text>
              <text x={90} y={yy + 88} fill={p.equipe.length ? ENCRE : "#9aa0a6"} fontSize={18} fontStyle={p.equipe.length ? undefined : "italic"}>
                {equipeTexte(p.equipe, 56)}
              </text>
              <text x={760} y={yy + 46} fill={p.caMois > 0 ? ENCRE : "#9aa0a6"} fontSize={23} fontWeight={700} textAnchor="end">
                {p.caMois > 0 ? keur(p.caMois) : "—"}
              </text>
              <text x={760} y={yy + 74} fill={GRIS} fontSize={17} textAnchor="end">
                {p.heuresMois > 0 ? heures(p.heuresMois) : ""}
              </text>
              <text x={LARGEUR - 90} y={yy + 46} fill={ENCRE} fontSize={21} fontWeight={700} textAnchor="end">
                {dateFR(p.livraison)}
              </text>
              {p.retard > 0 && (
                <text x={LARGEUR - 90} y={yy + 74} fill={ROUGE_ALERTE} fontSize={17} fontWeight={700} textAnchor="end">
                  échue depuis {p.retard} j
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
    y = y0 + prestations.length * hLigne + 56 + 60;
  }

  /* pied */
  const pied = [
    "Avancement = heures pointées ÷ heures chiffrées (commande et avenants). Équipe = personnes au planning, du début",
    `du mois aux 8 prochaines semaines. Délai : échéance du planning face à l’échéance initiale. POLYNOV-TEMPS, le ${aujourdhui}.`,
  ];
  blocs.push(
    <g key="pied">
      {pied.map((t, i) => (
        <text key={i} x={MARGE} y={y + i * 26} fill={GRIS} fontSize={17}>
          {t}
        </text>
      ))}
    </g>
  );
  const hauteur = y + pied.length * 26 + 30;

  return (
    <svg ref={refSvg} xmlns="http://www.w3.org/2000/svg" width={LARGEUR} height={hauteur} viewBox={`0 0 ${LARGEUR} ${hauteur}`} fontFamily={POLICE} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect width={LARGEUR} height={hauteur} fill="#f6f7f9" />
      {blocs}
    </svg>
  );
}

function NewsletterContenu() {
  const [donnees, setDonnees] = useState<DonneesNewsletter | null>(null);
  const [erreur, setErreur] = useState("");
  const [mois, setMois] = useState(() => decaler(new Date().toISOString().slice(0, 7), -1)); // le mois écoulé
  const [export_, setExport] = useState(false);
  const refSvg = useRef<SVGSVGElement>(null);
  const lundi = useMemo(() => lundiDe(aISO(new Date())), []);
  const dispos = useDisponibilitesActivites(lundi, NB_SEMAINES);

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
  const charge: ChargeActivite[] = useMemo(
    () =>
      dispos.chargement
        ? []
        : dispos.donnees
            .filter((a) => a.personnes.length > 0)
            .map((a) => ({ libelle: a.libelle, couleur: a.couleur, pc: a.capa.map((c, w) => (c > 0.5 ? Math.round((a.occ[w] / c) * 100) : null)) })),
    [dispos.chargement, dispos.donnees]
  );

  async function telecharger() {
    const svg = refSvg.current;
    if (!svg) return;
    setExport(true);
    try {
      const largeur = Number(svg.getAttribute("width")) || LARGEUR;
      const hauteur = Number(svg.getAttribute("height")) || 1350;
      const texte = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([texte], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise<void>((ok, ko) => {
        img.onload = () => ok();
        img.onerror = () => ko(new Error("Image illisible"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = largeur * 2;
      canvas.height = hauteur * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Dessin impossible");
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, largeur, hauteur);
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
  const pret = Boolean(n) && !dispos.chargement;

  return (
    <div style={{ ...page.contenu, maxWidth: 1000 }}>
      <h1 style={page.titre}>Newsletter du mois</h1>
      <p style={page.sousTitre}>
        L’image du mois pour l’équipe : le mois en chiffres, les activités, la charge à venir, les affaires en cours (équipe, avancement, délai) et les
        prestations PE / PI. Choisissez le mois, puis téléchargez l’image.
      </p>
      <div style={{ ...page.carte, padding: 12, margin: "14px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, -1))} aria-label="Mois précédent">
          ◀
        </button>
        <strong style={{ minWidth: 150, textAlign: "center" }}>{libMois(mois)}</strong>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, 1))} aria-label="Mois suivant">
          ▶
        </button>
        <button type="button" style={{ ...btn, marginLeft: "auto", background: C.rouge, color: "#ffffff", border: "none" }} disabled={!pret || export_} onClick={() => void telecharger()}>
          {export_ ? "Préparation…" : "⬇ Télécharger l’image (PNG)"}
        </button>
      </div>
      {(erreur || dispos.erreur) && <p style={{ color: C.rougeTexte }}>{erreur || dispos.erreur}</p>}
      {!pret && !erreur && <p style={{ color: C.gris }}>Lecture des chiffres…</p>}
      {n && pret && (
        <div style={{ ...page.carte, padding: 0, overflow: "hidden" }}>
          <ImageNewsletter n={n} charge={charge} semaines={dispos.semaines} refSvg={refSvg} />
        </div>
      )}
      {n && pret && (n.enCours.length > NB_AFFAIRES || n.prestations.length > NB_PRESTATIONS) && (
        <p style={{ fontSize: 13, color: C.gris }}>
          L’image montre les {Math.min(NB_AFFAIRES, n.nbEnCours)} affaires en cours au plus gros montant commandé (sur {n.nbEnCours}) et les{" "}
          {Math.min(NB_PRESTATIONS, n.prestations.length)} prestations PE / PI les plus facturées du mois (sur {n.prestations.length}).
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
        <OngletsPilotage actif="newsletter" />
        <NewsletterContenu />
      </main>
    </GardeAcces>
  );
}
