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
function Feuille({ n, numero, sousTitre, hBandeau, pied, refSvg, children }: { n: Newsletter; numero: number; sousTitre: string; hBandeau: number; pied: string[]; refSvg: React.Ref<SVGSVGElement>; children: ReactNode }) {
  const aujourdhui = new Date().toLocaleDateString("fr-FR");
  const lignes = [...pied, `POLYNOV-TEMPS, le ${aujourdhui} · ${numero} / 2`];
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
function ImageMois({ n, charge, semaines, refSvg }: { n: Newsletter; charge: ChargeActivite[]; semaines: string[]; refSvg: React.Ref<SVGSVGElement> }) {
  const blocs: ReactNode[] = [];
  let y = 270;
  const nomMois = (m: string) => MOIS[Number(m.slice(5, 7)) - 1];

  /* NEWSLETTER_CA : deux rangées de 3 tuiles (les faits du mois, puis le chiffre d'affaires) */
  const rangee = (cle: string, titre: string, droite: string | undefined, tuiles: { titre: string; valeur: string; sous: string; couleur: string }[]) => {
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
              <text x={x + 24} y={y0 + 106} fill={t.couleur} fontSize={t.valeur.length > 8 ? 44 : 54} fontWeight={800}>
                {t.valeur}
              </text>
              <text x={x + 24} y={y0 + 140} fill={GRIS} fontSize={19}>
                {t.sous}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + 160 + 76;
  };

  rangee("chiffres", "Le mois en chiffres", undefined, [
    { titre: "Commandes reçues", valeur: String(n.commandes.nombre), sous: keur(n.commandes.montant), couleur: "#1b5e20" },
    { titre: "Affaires livrées", valeur: String(n.livrees.nombre), sous: keur(n.livrees.montant), couleur: "#34506b" },
    { titre: "Devis ouverts", valeur: String(n.devis), sous: "nouveaux chiffrages", couleur: "#6b58a8" },
  ]);
  const pcCumul = n.cumulPrevu && n.cumulPrevu > 0.5 ? Math.round((n.cumulRealise / n.cumulPrevu) * 100) : null;
  rangee("ca", "Le chiffre d’affaires", `exercice ${n.exercice}`, [
    { titre: `CA prévu en ${nomMois(n.mois)}`, valeur: n.caPrevu === null ? "—" : keur(n.caPrevu), sous: `facturé à ce jour : ${keur(n.ca)}`, couleur: ROUGE },
    {
      titre: `CA de ${nomMois(n.moisPrecedent)}`,
      valeur: keur(n.caPrecedent),
      sous: n.caPrevuPrecedent === null ? "facturé" : `facturé · prévu ${keur(n.caPrevuPrecedent)}`,
      couleur: "#8a1c1c",
    },
    {
      titre: `Cumul nov. → ${nomMois(n.mois).slice(0, 4)}${nomMois(n.mois).length > 4 ? "." : ""}`,
      valeur: keur(n.cumulRealise),
      sous: n.cumulPrevu === null ? "facturé" : `prévu ${keur(n.cumulPrevu)}${pcCumul === null ? "" : ` · ${pcCumul} %`}`,
      couleur: "#5c0f0f",
    },
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
    y = y0 + 160 + 76;
  }

  if (charge.length > 0 && semaines.length > 0) {
    blocs.push(<Titre key="t-charge" y={y} texte="La charge à venir" droite="heures planifiées ÷ capacité" />);
    const y0 = y + 30;
    const xCases = MARGE + 190;
    const ecart = 14;
    const lCase = (LARGEUR - MARGE - 24 - xCases - (semaines.length - 1) * ecart) / semaines.length;
    const hRang = 70;
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
              <circle cx={MARGE + 36} cy={yy + 31} r={11} fill={a.couleur} />
              <text x={MARGE + 58} y={yy + 40} fill={ENCRE} fontSize={27} fontWeight={800}>
                {a.libelle}
              </text>
              {a.pc.map((pc, w) => {
                const x = xCases + w * (lCase + ecart);
                return (
                  <g key={w}>
                    <rect x={x} y={yy + 6} width={lCase} height={54} rx={12} fill={couleurCharge(pc)} />
                    <text x={x + lCase / 2} y={yy + 42} fill={pc === null ? GRIS : "#ffffff"} fontSize={26} fontWeight={800} textAnchor="middle">
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
    <Feuille n={n} numero={1} sousTitre="Le mois" hBandeau={190} refSvg={refSvg} pied={["CA facturé : règles de la page Finances (forfaits livrés, PE / PI des mois clôturés) ; CA prévu : prévisionnel saisi dans Finances.", "Activités : affaires au forfait en cours ayant des heures chiffrées dans l’activité."]}>
      {blocs}
    </Feuille>
  );
}

/* ---------------- Image 2 : les affaires ---------------- */
const H_BANDEAU_2 = 130;
const H_LIGNE_AFF = 98;
const H_LIGNE_PRE = 78;
const H_ENTETE = 50;
const BAS_UTILE = HAUTEUR - 120; // au-dessus du pied

function ImageAffaires({ n, refSvg }: { n: Newsletter; refSvg: React.Ref<SVGSVGElement> }) {
  // nombre de lignes : jusqu'à 4 prestations, les affaires remplissent le reste
  const yTitre1 = H_BANDEAU_2 + 76;
  const fixe = yTitre1 + 22 + H_ENTETE + 6 + (n.prestations.length > 0 ? 84 + 22 + H_ENTETE + 6 : 0);
  const nbPre = Math.min(n.prestations.length, 4);
  const nbAff = Math.max(0, Math.min(n.enCours.length, Math.floor((BAS_UTILE - fixe - nbPre * H_LIGNE_PRE) / H_LIGNE_AFF)));
  const affaires = n.enCours.slice(0, nbAff);
  const prestations = n.prestations.slice(0, nbPre);
  const xBarre = 590;
  const lBarre = 220;
  const blocs: ReactNode[] = [];

  let y = yTitre1;
  blocs.push(<Titre key="t-encours" y={y} texte="Affaires en cours" droite={`${n.nbEnCours} affaires au forfait${n.nbRetard > 0 ? ` · ${n.nbRetard} en retard` : ""}`} />);
  {
    const y0 = y + 22;
    blocs.push(
      <g key="encours">
        <rect x={MARGE} y={y0} width={LARG} height={affaires.length * H_LIGNE_AFF + H_ENTETE + 6} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        <text x={90} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700}>
          AFFAIRE · ACTIVITÉS · ÉQUIPE
        </text>
        <text x={xBarre} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700}>
          AVANCEMENT
        </text>
        <text x={LARGEUR - 90} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700} textAnchor="end">
          LIVRAISON
        </text>
        {affaires.map((a, i) => {
          const yy = y0 + H_ENTETE + i * H_LIGNE_AFF;
          const pc = a.avancement === null ? null : Math.round(a.avancement * 100);
          const plein = a.avancement === null ? 0 : Math.min(1, a.avancement);
          const couleur = pc === null ? "#c9ced6" : pc > 100 ? ROUGE_ALERTE : pc >= 80 ? ORANGE : VERT;
          const dl = libDelai(a);
          const xEquipe = 90 + a.activites.length * 26 + (a.activites.length ? 8 : 0);
          return (
            <g key={a.base}>
              {i > 0 && <line x1={90} x2={LARGEUR - 90} y1={yy} y2={yy} stroke="#eceef1" />}
              <text x={90} y={yy + 30} fill={ENCRE} fontSize={23} fontWeight={800}>
                {couper(`${a.client ? `${a.client} · ` : ""}CBE ${a.base}`, 34)}
              </text>
              <text x={90} y={yy + 56} fill={GRIS} fontSize={19}>
                {couper(a.designation, 44)}
              </text>
              {a.activites.map((x, k) => (
                <Pastille key={x.groupe} x={90 + k * 26} y={yy + 79} groupe={x.groupe} />
              ))}
              <text x={xEquipe} y={yy + 85} fill={a.equipe.length ? ENCRE : GRIS_CLAIR} fontSize={18} fontStyle={a.equipe.length ? undefined : "italic"}>
                {equipeTexte(a.equipe, 46 - a.activites.length * 3)}
              </text>
              <rect x={xBarre} y={yy + 26} width={lBarre} height={20} rx={10} fill="#eef0f3" />
              <rect x={xBarre} y={yy + 26} width={Math.max(plein > 0 ? 20 : 0, lBarre * plein)} height={20} rx={10} fill={couleur} />
              <text x={xBarre + lBarre + 12} y={yy + 43} fill={couleur} fontSize={21} fontWeight={800}>
                {pc === null ? "—" : `${pc} %`}
              </text>
              <text x={xBarre} y={yy + 74} fill={GRIS} fontSize={17}>
                {a.chiffre > 0.5 ? `${heures(a.pointe)} pointées sur ${heures(a.chiffre)}` : "pas d’heures chiffrées"}
              </text>
              <text x={LARGEUR - 90} y={yy + 42} fill={ENCRE} fontSize={21} fontWeight={700} textAnchor="end">
                {dateFR(a.livraison)}
              </text>
              <text x={LARGEUR - 90} y={yy + 70} fill={dl.couleur} fontSize={17} fontWeight={700} textAnchor="end">
                {dl.texte}
              </text>
            </g>
          );
        })}
      </g>
    );
    y = y0 + affaires.length * H_LIGNE_AFF + H_ENTETE + 6 + 84;
  }

  if (prestations.length > 0) {
    const nbPE = n.prestations.filter((p) => p.imputation === "PE").length;
    blocs.push(<Titre key="t-pepi" y={y} texte="Prestations PE / PI" droite={`${nbPE} PE · ${n.prestations.length - nbPE} PI`} />);
    const y0 = y + 22;
    blocs.push(
      <g key="pepi">
        <rect x={MARGE} y={y0} width={LARG} height={prestations.length * H_LIGNE_PRE + H_ENTETE + 6} rx={18} fill="#ffffff" stroke="#e3e6ea" />
        <text x={90} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700}>
          PRESTATION · ÉQUIPE
        </text>
        <text x={790} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700} textAnchor="end">
          HEURES DU MOIS
        </text>
        <text x={LARGEUR - 90} y={y0 + 34} fill={GRIS} fontSize={17} fontWeight={700} textAnchor="end">
          FIN PRÉVUE
        </text>
        {prestations.map((p, i) => {
          const yy = y0 + H_ENTETE + i * H_LIGNE_PRE;
          const coul = p.imputation === "PE" ? COULEURS_PE.fond : COULEURS_PI.fond;
          return (
            <g key={p.base}>
              {i > 0 && <line x1={90} x2={LARGEUR - 90} y1={yy} y2={yy} stroke="#eceef1" />}
              <rect x={90} y={yy + 11} width={44} height={26} rx={6} fill={coul} />
              <text x={112} y={yy + 30} fill="#ffffff" fontSize={16} fontWeight={800} textAnchor="middle">
                {p.imputation}
              </text>
              <text x={146} y={yy + 31} fill={ENCRE} fontSize={22} fontWeight={800}>
                {couper(`${p.client ? `${p.client} · ` : ""}CBE ${p.base}`, 22)}
                <tspan fontSize={19} fontWeight={400} fill={GRIS}>
                  {p.designation ? `  ${couper(p.designation, 30)}` : ""}
                </tspan>
              </text>
              <text x={90} y={yy + 62} fill={p.equipe.length ? ENCRE : GRIS_CLAIR} fontSize={18} fontStyle={p.equipe.length ? undefined : "italic"}>
                {equipeTexte(p.equipe, 60)}
              </text>
              <text x={790} y={yy + 42} fill={p.heuresMois > 0 ? ENCRE : GRIS_CLAIR} fontSize={21} fontWeight={700} textAnchor="end">
                {p.heuresMois > 0 ? heures(p.heuresMois) : "—"}
              </text>
              <text x={LARGEUR - 90} y={yy + 34} fill={ENCRE} fontSize={21} fontWeight={700} textAnchor="end">
                {dateFR(p.livraison)}
              </text>
              {p.retard > 0 && (
                <text x={LARGEUR - 90} y={yy + 60} fill={ROUGE_ALERTE} fontSize={17} fontWeight={700} textAnchor="end">
                  échue depuis {p.retard} j
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }

  const reste = [
    n.enCours.length > nbAff ? `${nbAff} affaires sur ${n.nbEnCours} (les plus importantes)` : "",
    n.prestations.length > nbPre ? `${nbPre} prestations sur ${n.prestations.length}` : "",
  ].filter(Boolean);
  return (
    <Feuille
      n={n}
      numero={2}
      sousTitre="Les affaires"
      hBandeau={H_BANDEAU_2}
      refSvg={refSvg}
      pied={[
        "Avancement = heures pointées ÷ heures chiffrées (commande et avenants). Équipe = personnes au planning, du début du mois",
        `aux 4 prochaines semaines. Délai : échéance du planning face à l’échéance initiale.${reste.length ? ` Montré : ${reste.join(", ")}.` : ""}`,
      ]}
    >
      {blocs}
    </Feuille>
  );
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
  const refMois = useRef<SVGSVGElement>(null);
  const refAffaires = useRef<SVGSVGElement>(null);
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

  async function telecharger(quoi: ("mois" | "affaires")[]) {
    setExport(true);
    try {
      for (const q of quoi) {
        const svg = q === "mois" ? refMois.current : refAffaires.current;
        if (svg) await enregistrerPNG(svg, `Newsletter_POLYNOV_${mois}_${q === "mois" ? "1_le-mois" : "2_les-affaires"}.png`);
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

  return (
    <div style={{ ...page.contenu, maxWidth: 1000 }}>
      <h1 style={page.titre}>Newsletter du mois</h1>
      <p style={page.sousTitre}>
        Deux images au format A4 : « Le mois » (chiffres, activités, charge des 4 prochaines semaines) et « Les affaires » (affaires en cours et prestations
        PE / PI : équipe, avancement, délai). Choisissez le mois, puis téléchargez.
      </p>
      <div style={{ ...page.carte, padding: 12, margin: "14px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, -1))} aria-label="Mois précédent">
          ◀
        </button>
        <strong style={{ minWidth: 150, textAlign: "center" }}>{libMois(mois)}</strong>
        <button type="button" style={btn} onClick={() => setMois((m) => decaler(m, 1))} aria-label="Mois suivant">
          ▶
        </button>
        <button type="button" style={{ ...btnPlein, marginLeft: "auto" }} disabled={!pret || export_} onClick={() => void telecharger(["mois", "affaires"])}>
          {export_ ? "Préparation…" : "⬇ Télécharger les 2 images (PNG)"}
        </button>
      </div>
      {(erreur || dispos.erreur) && <p style={{ color: C.rougeTexte }}>{erreur || dispos.erreur}</p>}
      {!pret && !erreur && <p style={{ color: C.gris }}>Lecture des chiffres…</p>}
      {n && pret && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {(
            [
              ["mois", "1 · Le mois"],
              ["affaires", "2 · Les affaires"],
            ] as const
          ).map(([q, titre]) => (
            <div key={q}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 6px" }}>
                <strong>{titre}</strong>
                <button type="button" style={btn} disabled={export_} onClick={() => void telecharger([q])}>
                  ⬇ PNG
                </button>
              </div>
              <div style={{ ...page.carte, padding: 0, overflow: "hidden" }}>
                {q === "mois" ? <ImageMois n={n} charge={charge} semaines={dispos.semaines} refSvg={refMois} /> : <ImageAffaires n={n} refSvg={refAffaires} />}
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
