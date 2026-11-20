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
   Les images mensuelles pour l'équipe (droit « indicateurs »), dessinées en
   SVG ici et téléchargeables en PNG. Chiffres : lib/newsletter.ts.
   NEWSLETTER_A4 (20/11/2026) : deux images au format A4 portrait
   (1080 × 1527, rapport √2), pour l'impression :
   1. « Le mois » : le mois en chiffres (montants), les activités, la charge
      des 4 prochaines semaines (Méca, Elec, Calcul) ;
   2. « Les affaires » : les affaires en cours (activités, équipe au planning,
      avancement en heures, livraison et délai) et les prestations PE / PI
      (équipe, heures du mois, fin prévue). Pas de montant dans le détail des
      affaires. Le nombre de lignes s'ajuste pour tenir dans la page.
================================================================ */

const LARGEUR = 1080;
const HAUTEUR = 1527; // A4 : 1080 × √2
const NB_SEMAINES = 4;
const ROUGE = "#c00000";
const ENCRE = "#1f2328";
const GRIS = "#5b6168";
const GRIS_CLAIR = "#9aa0a6";
const VERT = "#2e7d32";
const ORANGE = "#e08a1e";
const ROUGE_ALERTE = "#b3261e";
const POLICE = "Calibri, 'Segoe UI', Arial, sans-serif";
const MARGE = 60;
const LARG = LARGEUR - 2 * MARGE;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const majuscule = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
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

/* le cadre commun : fond, bandeau, pied */
function Feuille({ n, numero, total, sousTitre, hBandeau, pied, refSvg, children }: { n: Newsletter; numero: number; total: number; sousTitre: string; hBandeau: number; pied: string[]; refSvg: React.Ref<SVGSVGElement>; children: ReactNode }) {
  const aujourdhui = new Date().toLocaleDateString("fr-FR");
  const lignes = [...pied, `POLYNOV-TEMPS, le ${aujourdhui} · ${numero} / ${total}`];
  return (
    <svg ref={refSvg} xmlns="http://www.w3.org/2000/svg" width={LARGEUR} height={HAUTEUR} viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} fontFamily={POLICE} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect width={LARGEUR} height={HAUTEUR} fill="#f6f7f9" />
      <rect width={LARGEUR} height={hBandeau} fill={ROUGE} />
      {hBandeau > 170 ? (
        <>
          <text x={MARGE} y={80} fill="#ffffff" fontSize={26} fontWeight={700} letterSpacing={4}>
            POLYNOV · LE POINT DU MOIS
          </text>
          <text x={MARGE} y={152} fill="#ffffff" fontSize={66} fontWeight={800}>
            {majuscule(libMois(n.mois))}
          </text>
          <text x={LARGEUR - MARGE} y={152} fill="#ffffff" fontSize={28} fontWeight={700} textAnchor="end" opacity={0.9}>
            {sousTitre}
          </text>
        </>
      ) : (
        <>
          <text x={MARGE} y={hBandeau / 2 + 12} fill="#ffffff" fontSize={34} fontWeight={800}>
            {majuscule(libMois(n.mois))}
            <tspan fontSize={22} fontWeight={700} letterSpacing={3} dx={18} opacity={0.9}>
              POLYNOV · LE POINT DU MOIS
            </tspan>
          </text>
          <text x={LARGEUR - MARGE} y={hBandeau / 2 + 10} fill="#ffffff" fontSize={28} fontWeight={700} textAnchor="end">
            {sousTitre}
          </text>
        </>
      )}
      {children}
      {lignes.map((t, i) => (
        <text key={i} x={MARGE} y={HAUTEUR - 30 - (lignes.length - 1 - i) * 24} fill={GRIS} fontSize={16}>
          {t}
        </text>
      ))}
    </svg>
  );
}

/* ---------------- Image 1 : le mois ---------------- */
function ImageMois({ n, charge, semaines, total, noteCharge, refSvg }: { n: Newsletter; charge: ChargeActivite[]; semaines: string[]; total: number; noteCharge: string; refSvg: React.Ref<SVGSVGElement> }) {
  const blocs: ReactNode[] = [];
  let y = 270;
  const nomMois = (m: string) => MOIS[Number(m.slice(5, 7)) - 1];

  /* NEWSLETTER_CA : deux rangées de 3 tuiles (les faits du mois, puis le chiffre d'affaires) */
  const rangee = (cle: string, titre: string, droite: string | undefined, tuiles: { titre: string; valeur: string; sous: string; sous2?: string; couleur: string }[]) => {
    blocs.push(<Titre key={`t-${cle}`} y={y} texte={titre} droite={droite} />);
    const y0 = y + 28;
    const w = (LARG - (tuiles.length - 1) * 20) / tuiles.length;
    blocs.push(
      <g key={cle}>
        {tuiles.map((t, i) => {
          const x = MARGE + i * (w + 20);
          return (
            <g key={t.titre}>
              <rect x={x} y={y0} width={w} height={160} rx={18} fill="#ffffff" stroke="#e3e6ea" />
              <rect x={x} y={y0} width={w} height={8} rx={4} fill={t.couleur} />
              <text x={x + 24} y={y0 + 46} fill={GRIS} fontSize={22} fontWeight={700}>
                {t.titre}
              </text>
              <text x={x + 24} y={y0 + (t.sous2 ? 98 : 106)} fill={t.couleur} fontSize={t.valeur.length > 8 ? 42 : t.sous2 ? 48 : 54} fontWeight={800}>
                {t.valeur}
              </text>
              <text x={x + 24} y={y0 + (t.sous2 ? 126 : 140)} fill={GRIS} fontSize={18}>
                {t.sous}
              </text>
              {t.sous2 && (
                <text x={x + 24} y={y0 + 149} fill={ENCRE} fontSize={18} fontWeight={700}>
                  {t.sous2}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
    y = y0 + 160 + 58;
  };

  rangee("chiffres", "Le mois en chiffres", undefined, [
    { titre: "Commandes reçues", valeur: String(n.commandes.nombre), sous: keur(n.commandes.montant), couleur: "#1b5e20" },
    { titre: "Affaires livrées", valeur: String(n.livrees.nombre), sous: keur(n.livrees.montant), couleur: "#34506b" },
    { titre: "Devis ouverts", valeur: String(n.devis), sous: "nouveaux chiffrages", couleur: "#6b58a8" },
  ]);
  /* NEWSLETTER_PROJETE : CA de l'exercice en cours, puis CA projeté du mois choisi et du suivant */
  const pc = (a: number, b: number | null) => (b && b > 0.5 ? ` · ${Math.round((a / b) * 100)} %` : "");
  const ex = n.exercice;
  rangee("ca", "Le chiffre d’affaires", "projeté = facturé + attendu", [
    {
      titre: `CA ${ex.libelle}`,
      valeur: keur(ex.facture),
      sous: `facturé · projeté ${keur(ex.projete)}`,
      sous2: ex.prevu === null ? undefined : `prévu ${keur(ex.prevu)}${pc(ex.projete, ex.prevu)}`,
      couleur: "#5c0f0f",
    },
    ...n.projections.map((p, k) => ({
      titre: `CA projeté · ${nomMois(p.mois)}`,
      valeur: keur(p.projete),
      sous: `dont facturé ${keur(p.facture)}`,
      sous2: p.prevu === null ? undefined : `prévu ${keur(p.prevu)}${pc(p.projete, p.prevu)}`,
      couleur: k === 0 ? ROUGE : "#8a1c1c",
    })),
  ]);

  if (n.parActivite.length > 0) {
    blocs.push(<Titre key="t-act" y={y} texte="Les activités" droite={`${n.nbEnCours} affaires en cours au forfait`} />);
    const y0 = y + 30;
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
              <rect x={x} y={y0} width={w} height={160} rx={18} fill="#ffffff" stroke="#e3e6ea" />
              <rect x={x} y={y0} width={8} height={160} rx={4} fill={coul} />
              <text x={x + 26} y={y0 + 42} fill={coul} fontSize={26} fontWeight={800}>
                {a.groupe}
              </text>
              <text x={x + 26} y={y0 + 92} fill={ENCRE} fontSize={42} fontWeight={800}>
                {a.nb}
                <tspan fontSize={21} fontWeight={600} fill={GRIS}>
                  {a.nb > 1 ? " affaires" : " affaire"}
                </tspan>
              </text>
              <text x={x + 26} y={y0 + 122} fill={GRIS} fontSize={19}>
                {heures(a.reste)} restant à faire
              </text>
              <text x={x + 26} y={y0 + 146} fill={GRIS} fontSize={19}>
                {pc === null ? "" : `${pc} % du chiffré pointé`}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + 160 + 58;
  }

  /* NEWSLETTER_CHARGE : toujours sur la page 1, hauteur des rangs ajustée à la place restante au-dessus du pied */
  if (charge.length === 0 || semaines.length === 0) {
    blocs.push(<Titre key="t-charge" y={y} texte="La charge à venir" droite="heures planifiées ÷ capacité" />);
    blocs.push(
      <text key="charge-vide" x={MARGE} y={y + 70} fill={GRIS} fontSize={22}>
        {noteCharge}
      </text>
    );
  } else {
    blocs.push(<Titre key="t-charge" y={y} texte="La charge à venir" droite="heures planifiées ÷ capacité" />);
    const y0 = y + 30;
    const xCases = MARGE + 230;
    const ecart = 14;
    const lCase = (LARGEUR - MARGE - 24 - xCases - (semaines.length - 1) * ecart) / semaines.length;
    const basCadre = HAUTEUR - 30 - 3 * 24 - 50; // pied (3 lignes) et légende en dessous
    const hRang = Math.max(34, Math.min(70, Math.floor((basCadre - y0 - 56 - 14) / charge.length)));
    const hCase = hRang - 14;
    const fCase = Math.min(26, Math.round(hCase * 0.48));
    const hCadre = 56 + charge.length * hRang + 14;
    blocs.push(
      <g key="charge">
        <rect x={MARGE} y={y0} width={LARG} height={hCadre} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        {semaines.map((l, w) => (
          <text key={l} x={xCases + w * (lCase + ecart) + lCase / 2} y={y0 + 40} fill={GRIS} fontSize={20} fontWeight={700} textAnchor="middle">
            Semaine {numeroSemaine(l)}
          </text>
        ))}
        {charge.map((a, i) => {
          const yy = y0 + 56 + i * hRang;
          return (
            <g key={a.libelle}>
              <circle cx={MARGE + 36} cy={yy + 6 + hCase / 2} r={11} fill={a.couleur} />
              <text x={MARGE + 58} y={yy + 6 + hCase / 2 + fCase * 0.36} fill={ENCRE} fontSize={Math.min(27, fCase + 1)} fontWeight={800}>
                {a.libelle}
              </text>
              {a.pc.map((pc, w) => {
                const x = xCases + w * (lCase + ecart);
                return (
                  <g key={w}>
                    <rect x={x} y={yy + 6} width={lCase} height={hCase} rx={12} fill={couleurCharge(pc)} />
                    <text x={x + lCase / 2} y={yy + 6 + hCase / 2 + fCase * 0.36} fill={pc === null ? GRIS : "#ffffff"} fontSize={fCase} fontWeight={800} textAnchor="middle">
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
    blocs.push(
      <text key="legende-charge" x={MARGE} y={y0 + hCadre + 36} fill={GRIS} fontSize={18}>
        Vert clair : de la place · vert : bien chargé · orange : 85 % et plus · rouge : surcharge (plus de 100 %).
      </text>
    );
  }

  return (
    <Feuille n={n} numero={1} total={total} sousTitre="Le mois" hBandeau={190} refSvg={refSvg} pied={["Facturé : règles de Finances. Attendu : forfaits au mois de leur délai estimé, PE / PI non clôturées. Prévu : prévisionnel de Finances.", "Activités : affaires au forfait en cours ayant des heures chiffrées dans l’activité."]}>
      {blocs}
    </Feuille>
  );
}

/* ---------------- Images suivantes : les affaires (NEWSLETTER_PORTEFEUILLE) ----------------
   Toutes les affaires du Suivi des affaires (forfaits en cours ou en intention, une ligne par famille) puis toutes les
   PE / PI du relevé en cours (hors dormantes), en lignes compactes, réparties sur autant de pages A4 que nécessaire. */
const H_BANDEAU_2 = 130;
const H_ENTETE = 46;
const BAS_UTILE = HAUTEUR - 112; // au-dessus du pied
const H_LIGNE_AFF = 66;
const H_LIGNE_PRE = 60;

type Colonne = { x: number; texte: string; ancre?: "start" | "end" };
type Section = { cle: string; titre: string; droite: string; colonnes: Colonne[]; hLigne: number; nb: number; ligne: (i: number, yy: number) => ReactNode };
type Morceau = { section: Section; debut: number; fin: number; suite: boolean };

/* répartit les sections sur des pages : une section continue sur la page suivante (« suite ») */
function paginer(sections: Section[]): Morceau[][] {
  const pages: Morceau[][] = [];
  let courante: Morceau[] = [];
  let y = H_BANDEAU_2 + 76;
  const nouvellePage = () => {
    if (courante.length) pages.push(courante);
    courante = [];
    y = H_BANDEAU_2 + 76;
  };
  for (const s of sections) {
    let i = 0;
    while (i < s.nb) {
      const place = Math.floor((BAS_UTILE - y - 22 - H_ENTETE - 6) / s.hLigne);
      if (place < Math.min(3, s.nb - i)) {
        if (courante.length === 0) break; // page vide trop petite : ne peut pas arriver, garde-fou
        nouvellePage();
        continue;
      }
      const k = Math.min(place, s.nb - i);
      courante.push({ section: s, debut: i, fin: i + k, suite: i > 0 });
      y += 22 + H_ENTETE + 6 + k * s.hLigne + 84;
      i += k;
    }
  }
  if (courante.length) pages.push(courante);
  return pages;
}

function ImageListe({ n, morceaux, numero, total, refSvg }: { n: Newsletter; morceaux: Morceau[]; numero: number; total: number; refSvg: React.Ref<SVGSVGElement> }) {
  const blocs: ReactNode[] = [];
  let y = H_BANDEAU_2 + 76;
  for (const m of morceaux) {
    const s = m.section;
    blocs.push(<Titre key={`t-${s.cle}-${m.debut}`} y={y} texte={m.suite ? `${s.titre} (suite)` : s.titre} droite={m.suite ? undefined : s.droite} />);
    const y0 = y + 22;
    const k = m.fin - m.debut;
    blocs.push(
      <g key={`${s.cle}-${m.debut}`}>
        <rect x={MARGE} y={y0} width={LARG} height={H_ENTETE + 6 + k * s.hLigne} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        {s.colonnes.map((c) => (
          <text key={c.texte} x={c.x} y={y0 + 31} fill={GRIS} fontSize={16} fontWeight={700} textAnchor={c.ancre ?? "start"}>
            {c.texte}
          </text>
        ))}
        {Array.from({ length: k }, (_, j) => {
          const yy = y0 + H_ENTETE + j * s.hLigne;
          return (
            <g key={j}>
              <line x1={90} x2={LARGEUR - 90} y1={yy} y2={yy} stroke="#eceef1" />
              {s.ligne(m.debut + j, yy)}
            </g>
          );
        })}
      </g>
    );
    y = y0 + H_ENTETE + 6 + k * s.hLigne + 84;
  }
  const cles = [...new Set(morceaux.map((m) => m.section.cle))];
  return (
    <Feuille
      n={n}
      numero={numero}
      total={total}
      sousTitre={cles.length === 1 && cles[0] === "pepi" ? "Les prestations" : "Les affaires"}
      hBandeau={H_BANDEAU_2}
      refSvg={refSvg}
      pied={
        cles.includes("forfaits")
          ? [
              "Affaires du Suivi des affaires (forfaits en cours ou en intention, une ligne par famille). Avancement = heures pointées ÷ chiffrées.",
              "Équipe = personnes au planning, du début du mois aux 4 prochaines semaines. Délai : échéance du planning face à l’initiale.",
            ]
          : ["PE / PI du relevé en cours (hors dormantes). Équipe = personnes au planning, du début du mois aux 4 prochaines semaines."]
      }
    >
      {blocs}
    </Feuille>
  );
}

function sectionsAffaires(n: Newsletter): Section[] {
  const xBarre = 640;
  const lBarre = 150;
  const forfaits: Section = {
    cle: "forfaits",
    titre: "Affaires en cours",
    droite: `${n.nbEnCours} affaires au forfait${n.nbRetard > 0 ? ` · ${n.nbRetard} en retard` : ""}`,
    colonnes: [
      { x: 90, texte: "AFFAIRE · ÉQUIPE" },
      { x: xBarre, texte: "AVANCEMENT" },
      { x: LARGEUR - 90, texte: "LIVRAISON", ancre: "end" },
    ],
    hLigne: H_LIGNE_AFF,
    nb: n.enCours.length,
    ligne: (i, yy) => {
      const a = n.enCours[i];
      const pc = a.avancement === null ? null : Math.round(a.avancement * 100);
      const plein = a.avancement === null ? 0 : Math.min(1, a.avancement);
      const couleur = pc === null ? "#c9ced6" : pc > 100 ? ROUGE_ALERTE : pc >= 80 ? ORANGE : VERT;
      const dl = libDelai(a);
      const nAct = a.activites.length;
      const xTexte = 90 + nAct * 24 + (nAct ? 6 : 0);
      const tete = couper(`${a.client ? `${a.client} · ` : ""}CBE ${a.base}`, 26);
      const reste = Math.max(6, 50 - tete.length - nAct * 2);
      return (
        <>
          {a.activites.map((x, k) => (
            <Pastille key={x.groupe} x={90 + k * 24} y={yy + 22} groupe={x.groupe} />
          ))}
          <text x={xTexte} y={yy + 29} fill={ENCRE} fontSize={20} fontWeight={800}>
            {tete}
            {a.designation && (
              <tspan fontSize={17} fontWeight={400} fill={GRIS}>
                {`  ${couper(a.designation, reste)}`}
              </tspan>
            )}
          </text>
          <text x={90} y={yy + 54} fill={a.equipe.length ? ENCRE : GRIS_CLAIR} fontSize={16} fontStyle={a.equipe.length ? undefined : "italic"}>
            {a.intention && (
              <tspan fill={ORANGE} fontWeight={700} fontStyle="normal">
                {"Intention de commande · "}
              </tspan>
            )}
            {equipeTexte(a.equipe, a.intention ? 42 : 62)}
          </text>
          <rect x={xBarre} y={yy + 15} width={lBarre} height={16} rx={8} fill="#eef0f3" />
          <rect x={xBarre} y={yy + 15} width={Math.max(plein > 0 ? 16 : 0, lBarre * plein)} height={16} rx={8} fill={couleur} />
          <text x={xBarre + lBarre + 10} y={yy + 29} fill={couleur} fontSize={18} fontWeight={800}>
            {pc === null ? "—" : `${pc} %`}
          </text>
          <text x={xBarre} y={yy + 54} fill={GRIS} fontSize={15}>
            {a.chiffre > 0.5 ? `${heures(a.pointe)} / ${heures(a.chiffre)}` : "pas d’heures chiffrées"}
          </text>
          <text x={LARGEUR - 90} y={yy + 29} fill={ENCRE} fontSize={19} fontWeight={700} textAnchor="end">
            {dateFR(a.livraison)}
          </text>
          <text x={LARGEUR - 90} y={yy + 54} fill={dl.couleur} fontSize={15} fontWeight={700} textAnchor="end">
            {dl.texte}
          </text>
        </>
      );
    },
  };
  const nbPE = n.prestations.filter((p) => p.imputation === "PE").length;
  const pepi: Section = {
    cle: "pepi",
    titre: "Prestations PE / PI",
    droite: `${nbPE} PE · ${n.prestations.length - nbPE} PI en cours`,
    colonnes: [
      { x: 90, texte: "PRESTATION · ÉQUIPE" },
      { x: 800, texte: "HEURES DU MOIS", ancre: "end" },
      { x: LARGEUR - 90, texte: "FIN PRÉVUE", ancre: "end" },
    ],
    hLigne: H_LIGNE_PRE,
    nb: n.prestations.length,
    ligne: (i, yy) => {
      const p = n.prestations[i];
      const coul = p.imputation === "PE" ? COULEURS_PE.fond : COULEURS_PI.fond;
      const tete = couper(`${p.client ? `${p.client} · ` : ""}CBE ${p.base}`, 26);
      return (
        <>
          <rect x={90} y={yy + 10} width={40} height={24} rx={6} fill={coul} />
          <text x={110} y={yy + 27} fill="#ffffff" fontSize={15} fontWeight={800} textAnchor="middle">
            {p.imputation}
          </text>
          <text x={142} y={yy + 28} fill={ENCRE} fontSize={20} fontWeight={800}>
            {tete}
            {p.designation && (
              <tspan fontSize={17} fontWeight={400} fill={GRIS}>
                {`  ${couper(p.designation, Math.max(6, 50 - tete.length))}`}
              </tspan>
            )}
          </text>
          <text x={142} y={yy + 51} fill={p.equipe.length ? ENCRE : GRIS_CLAIR} fontSize={16} fontStyle={p.equipe.length ? undefined : "italic"}>
            {equipeTexte(p.equipe, 60)}
          </text>
          <text x={800} y={yy + 28} fill={p.heuresMois > 0 ? ENCRE : GRIS_CLAIR} fontSize={19} fontWeight={700} textAnchor="end">
            {p.heuresMois > 0 ? heures(p.heuresMois) : "—"}
          </text>
          <text x={LARGEUR - 90} y={yy + 28} fill={ENCRE} fontSize={19} fontWeight={700} textAnchor="end">
            {dateFR(p.livraison)}
          </text>
          {p.retard > 0 && (
            <text x={LARGEUR - 90} y={yy + 51} fill={ROUGE_ALERTE} fontSize={15} fontWeight={700} textAnchor="end">
              échue depuis {p.retard} j
            </text>
          )}
        </>
      );
    },
  };
  return [forfaits, pepi].filter((s) => s.nb > 0);
}

/* ---------------- Export PNG ---------------- */
async function enregistrerPNG(svg: SVGSVGElement, nom: string) {
  const texte = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([texte], { type: "image/svg+xml;charset=utf-8" }));
  try {
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
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = nom;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function NewsletterContenu() {
  const [donnees, setDonnees] = useState<DonneesNewsletter | null>(null);
  const [erreur, setErreur] = useState("");
  const [mois, setMois] = useState(() => decaler(new Date().toISOString().slice(0, 7), -1)); // le mois écoulé
  const [export_, setExport] = useState(false);
  const refs = useRef<(SVGSVGElement | null)[]>([]);
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
  const pagesListe = useMemo(() => (n ? paginer(sectionsAffaires(n)) : []), [n]);
  const total = 1 + pagesListe.length;
  const charge: ChargeActivite[] = useMemo(
    () =>
      dispos.chargement
        ? []
        : dispos.donnees
            .filter((a) => a.personnes.length > 0)
            .map((a) => ({ libelle: a.libelle, couleur: a.couleur, pc: a.capa.map((c, w) => (c > 0.5 ? Math.round((a.occ[w] / c) * 100) : null)) })),
    [dispos.chargement, dispos.donnees]
  );

  async function telecharger(indices: number[]) {
    setExport(true);
    try {
      for (const i of indices) {
        const svg = refs.current[i];
        if (svg) await enregistrerPNG(svg, `Newsletter_POLYNOV_${mois}_${i + 1}.png`);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setExport(false);
    }
  }

  const btn: CSSProperties = { minHeight: 38, minWidth: 38, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: "0 12px" };
  const btnPlein: CSSProperties = { ...btn, background: C.rouge, color: "#ffffff", border: "none" };
  const pret = Boolean(n) && !dispos.chargement;
  const titres = ["Le mois", ...pagesListe.map((p) => (p.some((m) => m.section.cle === "forfaits") ? "Les affaires" : "Les prestations PE / PI"))];

  return (
    <div style={{ ...page.contenu, maxWidth: 1000 }}>
      <h1 style={page.titre}>Newsletter du mois</h1>
      <p style={page.sousTitre}>
        Des pages A4 : « Le mois » (chiffres, chiffre d’affaires, activités, charge des 4 prochaines semaines), puis toutes les affaires du Suivi des
        affaires et toutes les PE / PI du relevé en cours (équipe, avancement, délai), sur autant de pages que nécessaire. Choisissez le mois, puis
        téléchargez.
      </p>
      <div style={{ ...page.carte, padding: 12, margin: "14px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, -1))} aria-label="Mois précédent">
          ◀
        </button>
        <strong style={{ minWidth: 150, textAlign: "center" }}>{libMois(mois)}</strong>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, 1))} aria-label="Mois suivant">
          ▶
        </button>
        <button type="button" style={{ ...btnPlein, marginLeft: "auto" }} disabled={!pret || export_} onClick={() => void telecharger(Array.from({ length: total }, (_, i) => i))}>
          {export_ ? "Préparation…" : `⬇ Télécharger les ${total} pages (PNG)`}
        </button>
      </div>
      {(erreur || dispos.erreur) && <p style={{ color: C.rougeTexte }}>{erreur || dispos.erreur}</p>}
      {!pret && !erreur && <p style={{ color: C.gris }}>Lecture des chiffres…</p>}
      {n && pret && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {titres.map((titre, i) => (
            <div key={i}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 6px" }}>
                <strong>
                  {i + 1} · {titre}
                </strong>
                <button type="button" style={btn} disabled={export_} onClick={() => void telecharger([i])}>
                  ⬇ PNG
                </button>
              </div>
              <div style={{ ...page.carte, padding: 0, overflow: "hidden" }}>
                {i === 0 ? (
                  <ImageMois
                    n={n}
                    charge={charge}
                    semaines={dispos.semaines}
                    total={total}
                    noteCharge={
                      dispos.erreur
                        ? `Charge non disponible : ${dispos.erreur}`
                        : dispos.chargement
                          ? "Chargement du planning…"
                          : "Aucune activité avec des personnes affectées (activité principale des collaborateurs)."
                    }
                    refSvg={(el) => {
                      refs.current[0] = el;
                    }}
                  />
                ) : (
                  <ImageListe
                    n={n}
                    morceaux={pagesListe[i - 1]}
                    numero={i + 1}
                    total={total}
                    refSvg={(el) => {
                      refs.current[i] = el;
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
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
