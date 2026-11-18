"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chakra_Petch, Share_Tech_Mono } from "next/font/google";
import s from "./ConsoleRentabilite.module.css";
import { PAR_CLE, calcul, type Cle, type Depart, type Leviers } from "@/lib/simulateur";

/* ===============================================================
   SIMULATEUR : LA CUVE (SIMULATEUR_CUVE, PLG, 18/11/2026)
   Maquette validée : https://claude.ai/artifact/B5nV3amoCS31BjJXp9Qy7P
   Les robinets (production, marge négoce, scan) remplissent, les fuites
   (salaires, location, autres frais, fees) vident, le niveau d'eau est le
   résultat de l'exercice. Chaque réglage est une VANNE GRADUÉE posée sur
   le circuit : on la tourne en glissant (haut / bas), à la molette ou
   aux flèches du clavier ; double-clic : retour à nos chiffres. Les deux
   taux portent leur plafond marché en rouge (au-delà : CA écrêté, CLIP).
   Même calcul que la console (calcul() de lib/simulateur.ts), mêmes
   chiffres de départ (SimulateurContenu).
================================================================ */

const fUi = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-ui" });
const fLcd = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--f-lcd" });

const MARGE_VISEE = 6; // % du CA : le repère orange de la cuve
const BLEU = "#4aa3ff";
const ORANGE = "#ff8a5c";

const fr = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const k = (n: number) => `${n < 0 ? "−" : ""}${fr(Math.abs(n) / 1000)} k€`;
const borner = (cle: Cle, x: number) => {
  const l = PAR_CLE[cle];
  const r = Math.round((Math.min(l.max, Math.max(l.min, x)) - l.min) / l.pas) * l.pas + l.min;
  return Number(r.toFixed(4));
};

/* ---------------- une vanne graduée ---------------- */
function Vanne({
  cle,
  cx,
  cy,
  libelle,
  valeur,
  depart,
  plafond,
  couleur,
  onChange,
}: {
  cle: Cle;
  cx: number;
  cy: number;
  libelle: string;
  valeur: number;
  depart: number;
  plafond?: number;
  couleur: string;
  onChange: (x: number) => void;
}) {
  const l = PAR_CLE[cle];
  const g = useRef<SVGGElement>(null);
  const glisse = useRef<{ y: number; v: number } | null>(null);
  const derniere = useRef({ valeur, onChange });
  derniere.current = { valeur, onChange };

  // molette : écouteur non passif, pour ne pas faire défiler la page
  useEffect(() => {
    const el = g.current;
    if (!el) return;
    const h = (ev: WheelEvent) => {
      ev.preventDefault();
      derniere.current.onChange(derniere.current.valeur + (ev.deltaY < 0 ? l.pas : -l.pas));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [l.pas]);

  const r = 18;
  const a0 = 135;
  const a1 = 405;
  const ang = (x: number) => a0 + (a1 - a0) * Math.max(0, Math.min(1, (x - l.min) / (l.max - l.min)));
  const P = (deg: number, rr: number) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)] as const;
  const arc = (de: number, au: number) => {
    if (au - de < 0.5) return "";
    const [x1, y1] = P(de, r);
    const [x2, y2] = P(au, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${au - de > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  let graduations = "";
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    const [xa, ya] = P(a, 21);
    const [xb, yb] = P(a, i % 5 === 0 ? 26 : 24);
    graduations += `M ${xa} ${ya} L ${xb} ${yb} `;
  }
  const clip = plafond !== undefined && valeur > plafond + 1e-9;
  const [px, py] = P(ang(valeur), 14);
  const plafondTrait = plafond !== undefined && plafond >= l.min && plafond <= l.max ? [P(ang(plafond), 20), P(ang(plafond), 28)] : null;
  const aff = `${fr(valeur, l.dec)}`;

  return (
    <g
      ref={g}
      role="slider"
      tabIndex={0}
      aria-label={`${l.nom} (${l.u})`}
      aria-valuemin={l.min}
      aria-valuemax={l.max}
      aria-valuenow={valeur}
      aria-valuetext={`${fr(valeur, l.dec)} ${l.u}${clip ? ", au-delà du plafond" : ""}`}
      style={{ cursor: "ns-resize", touchAction: "none", outline: "none" }}
      onPointerDown={(ev) => {
        (ev.currentTarget as SVGGElement).setPointerCapture(ev.pointerId);
        glisse.current = { y: ev.clientY, v: valeur };
        (ev.currentTarget as SVGGElement).focus();
      }}
      onPointerMove={(ev) => {
        if (!glisse.current) return;
        // 150 px de glissé = toute la graduation
        onChange(glisse.current.v + ((glisse.current.y - ev.clientY) / 150) * (l.max - l.min));
      }}
      onPointerUp={() => (glisse.current = null)}
      onPointerCancel={() => (glisse.current = null)}
      onDoubleClick={() => onChange(depart)}
      onKeyDown={(ev) => {
        const pas = ({ ArrowUp: l.pas, ArrowRight: l.pas, ArrowDown: -l.pas, ArrowLeft: -l.pas } as Record<string, number>)[ev.key];
        if (pas !== undefined) {
          ev.preventDefault();
          onChange(valeur + pas);
        }
      }}
    >
      <title>{`${l.nom} : ${fr(valeur, l.dec)} ${l.u}${plafond !== undefined ? ` (plafond ${fr(plafond, 1)})` : ""}. Glisser, molette ou flèches ; double-clic : nos chiffres.`}</title>
      <circle cx={cx} cy={cy} r={24} fill="#1d2024" stroke={clip ? "#ff3b30" : "#5a6168"} strokeWidth={clip ? 3 : 2} />
      <path d={arc(a0, a1)} fill="none" stroke="#33383e" strokeWidth={5} strokeLinecap="round" />
      <path d={arc(a0, ang(valeur))} fill="none" stroke={clip ? "#ff3b30" : couleur} strokeWidth={5} strokeLinecap="round" />
      <path d={graduations} stroke="#9aa1a8" strokeWidth={1.2} />
      {plafondTrait && <line x1={plafondTrait[0][0]} y1={plafondTrait[0][1]} x2={plafondTrait[1][0]} y2={plafondTrait[1][1]} stroke="#ff3b30" strokeWidth={3} />}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke="#ff5a4f" strokeWidth={2.5} strokeLinecap="round" />
      <text x={cx} y={cy + 15} fill={clip ? "#ff8a7a" : "#ffb547"} fontSize={10.5} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
        {clip ? "CLIP" : aff}
      </text>
      <text x={cx} y={cy + 40} fill="#e9e6df" fontSize={10.5} textAnchor="middle">
        {libelle}
      </text>
      {/* zone de prise plus grande que la vanne */}
      <circle cx={cx} cy={cy} r={30} fill="transparent" />
    </g>
  );
}

/* ---------------- la cuve ---------------- */
export default function CuveRentabilite({
  depart,
  versionDepart,
  entete,
  message,
}: {
  depart: Depart;
  versionDepart: string;
  entete: ReactNode;
  message?: ReactNode;
}) {
  const [v, setV] = useState<Leviers>(depart.valeurs);
  // nouvel exercice (ou mute) : les vannes reviennent sur nos chiffres
  useEffect(() => {
    setV(depart.valeurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionDepart]);

  const regler = (cle: Cle) => (x: number) => setV((p) => ({ ...p, [cle]: borner(cle, x) }));
  const a = calcul(v);
  const ref = calcul(depart.valeurs);

  const margeNeg = (a.caNeg * v.mneg) / 100;
  const entrees = a.caProd + margeNeg + a.caScan;
  const sorties = a.salaires + a.loyer + a.autres + a.fees;
  const negatif = a.resultat < 0;

  // l'échelle de la cuve suit nos chiffres de départ (elle ne bouge pas quand on tourne les vannes)
  const echelle = Math.max(200000, ref.ca);
  const MIN = -0.25 * echelle;
  const MAX = 0.4 * echelle;
  const haut = 232;
  const bas = 618;
  const y = (x: number) => bas - ((Math.max(MIN, Math.min(MAX, x)) - MIN) / (MAX - MIN)) * (bas - haut);
  const niveauY = y(a.resultat);
  const zeroY = y(0);
  const cibleY = y((a.ca * MARGE_VISEE) / 100);
  const maxi = Math.max(1, a.caProd, margeNeg, a.caScan, a.salaires, a.loyer, a.autres, a.fees);
  const w = (x: number) => (x <= 0 ? 0 : 3 + (27 * x) / maxi);

  const vanne = (cle: Cle, cx: number, cy: number, libelle: string, couleur: string, plafond?: Cle) => (
    <Vanne
      key={cle}
      cle={cle}
      cx={cx}
      cy={cy}
      libelle={libelle}
      valeur={v[cle]}
      depart={depart.valeurs[cle]}
      plafond={plafond ? v[plafond] : undefined}
      couleur={couleur}
      onChange={regler(cle)}
    />
  );

  return (
    <div className={`${s.fond} ${fUi.variable} ${fLcd.variable}`}>
      <style>{`
        @keyframes cuveCouler { to { stroke-dashoffset: -28 } }
        @keyframes cuveVague { to { stroke-dashoffset: -40 } }
        .cuveFlux { stroke-dasharray: 10 4; animation: cuveCouler .6s linear infinite }
        .cuveFuite { stroke-dasharray: 6 6; animation: cuveCouler .9s linear infinite }
        .cuveSurface { stroke-dasharray: 14 6; animation: cuveVague 2.4s linear infinite }
        .cuveEau { transition: y .35s ease, height .35s ease }
        g[role=slider]:focus-visible circle:first-of-type { stroke: #ffb547; stroke-width: 3 }
        @media (prefers-reduced-motion: reduce) { .cuveFlux, .cuveFuite, .cuveSurface { animation: none } .cuveEau { transition: none } }
      `}</style>
      <div className={s.console}>
        <header className={s.tete}>
          <div className={s.marque}>
            <h1>
              <b>●</b> Simulateur : la cuve
            </h1>
            <span>Les robinets remplissent, les fuites vident, le niveau d’eau est le résultat de l’exercice</span>
          </div>
          {entete}
        </header>
        <p className={s.note}>
          Chaque <b>vanne graduée</b> règle un mécanisme : tournez-la en <b>glissant vers le haut ou le bas</b>, à la molette ou aux flèches du clavier ;
          double-clic : retour à nos chiffres. Les deux taux portent leur <b>plafond marché en rouge</b> : au-delà, la vanne affiche CLIP et le CA est écrêté.
        </p>
        {message}

        <div className={s.plateau}>
          <section className={s.table} style={{ overflow: "hidden" }} aria-label="La cuve">
            <svg viewBox="0 0 960 870" style={{ width: "100%", height: "auto", display: "block" }} role="group" aria-label={`Cuve : le niveau d’eau vaut ${k(a.resultat)} de résultat`}>
              <defs>
                <linearGradient id="cuveEau" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={negatif ? "#ff7a6b" : BLEU} />
                  <stop offset="1" stopColor={negatif ? "#8f1d16" : "#123f75"} />
                </linearGradient>
              </defs>

              <text x={40} y={18} fill={BLEU} fontSize={12} letterSpacing={2} fontWeight={700}>
                CE QUI RENTRE
              </text>
              {/* conduites d'arrivée */}
              <rect x={60} y={58} width={340} height={8} rx={4} fill="#4b525a" />
              <rect x={490} y={58} width={84} height={8} rx={4} fill="#4b525a" />
              <rect x={680} y={58} width={84} height={8} rx={4} fill="#4b525a" />
              <rect x={226} y={62} width={8} height={98} fill="#4b525a" />
              <rect x={528} y={62} width={8} height={98} fill="#4b525a" />
              <rect x={718} y={62} width={8} height={98} fill="#4b525a" />
              <text x={230} y={128} fill="#9aa1a8" fontSize={11} letterSpacing={2} textAnchor="middle">
                PRODUCTION
              </text>
              <text x={532} y={128} fill="#9aa1a8" fontSize={11} letterSpacing={2} textAnchor="middle">
                NÉGOCE
              </text>
              <text x={722} y={128} fill="#9aa1a8" fontSize={11} letterSpacing={2} textAnchor="middle">
                SCAN
              </text>

              {/* robinets et filets */}
              {(
                [
                  [230, a.caProd],
                  [532, margeNeg],
                  [722, a.caScan],
                ] as [number, number][]
              ).map(([x, montant]) => (
                <g key={x}>
                  <rect x={x - 10} y={158} width={20} height={30} fill="#6b737c" />
                  <rect x={x - 22} y={186} width={44} height={10} rx={3} fill="#8d9298" />
                  <line x1={x} y1={196} x2={x} y2={niveauY} stroke={BLEU} strokeWidth={w(montant)} className="cuveFlux" opacity={0.9} />
                  <text x={x + 28} y={186} fill="#ffb547" fontSize={14} style={{ fontFamily: "var(--f-lcd), monospace" }}>
                    {k(montant)}
                  </text>
                </g>
              ))}

              {/* la cuve */}
              <rect x={80} y={230} width={720} height={390} rx={6} fill="#0e1013" stroke="#9aa1a8" strokeWidth={3} />
              <rect x={82} y={zeroY} width={716} height={Math.max(0, bas - zeroY)} fill="#ff5a4f" opacity={0.08} />
              <rect className="cuveEau" x={82} y={niveauY} width={716} height={Math.max(0, bas - niveauY)} fill="url(#cuveEau)" opacity={0.85} />
              <line x1={84} y1={niveauY} x2={796} y2={niveauY} stroke="#bfe3ff" strokeWidth={3} className="cuveSurface" />
              <line x1={70} y1={zeroY} x2={810} y2={zeroY} stroke="#e9e6df" strokeWidth={2} strokeDasharray="8 6" />
              <text x={816} y={zeroY + 4} fill="#e9e6df" fontSize={13}>
                0 € : flottaison
              </text>
              <text x={816} y={zeroY + 20} fill="#ff8a7a" fontSize={11}>
                en dessous : perte
              </text>
              <line x1={70} y1={cibleY} x2={810} y2={cibleY} stroke="#ffb547" strokeWidth={2} strokeDasharray="3 5" />
              <text x={816} y={cibleY + 4} fill="#ffb547" fontSize={13}>
                marge visée {MARGE_VISEE} %
              </text>
              <text x={440} y={Math.max(262, Math.min(598, niveauY - 14))} fill="#ffffff" fontSize={26} fontWeight={700} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
                {a.resultat >= 0 ? "+" : ""}
                {k(a.resultat)}
              </text>
              <text x={440} y={Math.max(280, Math.min(614, niveauY + 6))} fill="#d7ecff" fontSize={13} textAnchor="middle">
                {fr(a.marge * 100, 1)} % du CA
              </text>

              {/* les fuites */}
              <text x={40} y={652} fill={ORANGE} fontSize={12} letterSpacing={2} fontWeight={700}>
                CE QUI SORT
              </text>
              <rect x={178} y={618} width={8} height={152} fill="#4b525a" />
              <rect x={356} y={618} width={8} height={152} fill="#4b525a" />
              <rect x={516} y={618} width={8} height={152} fill="#4b525a" />
              <rect x={676} y={618} width={8} height={152} fill="#4b525a" />
              <rect x={130} y={686} width={104} height={8} rx={4} fill="#4b525a" />
              {(
                [
                  [182, a.salaires, "Salaires"],
                  [360, a.loyer, "Location"],
                  [520, a.autres, "Autres frais"],
                  [680, a.fees, "Mgmt fees"],
                ] as [number, number, string][]
              ).map(([x, montant, lib]) => (
                <g key={lib}>
                  <line x1={x} y1={772} x2={x} y2={810} stroke="#c4501b" strokeWidth={w(montant)} className="cuveFuite" />
                  <text x={x} y={830} fill="#e9e6df" fontSize={13} fontWeight={700} textAnchor="middle">
                    {lib}
                  </text>
                  <text x={x} y={848} fill="#ffb547" fontSize={13} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
                    {k(montant)}
                  </text>
                </g>
              ))}

              {/* les vannes graduées (au-dessus de tout, pour être saisies) */}
              {vanne("calc", 78, 62, "Calcul", BLEU)}
              {vanne("prod", 142, 62, "Autres", BLEU)}
              {vanne("occ", 206, 62, "Occupation", BLEU)}
              {vanne("eff", 270, 62, "Efficience", BLEU)}
              {vanne("tcalc", 334, 62, "Taux Calcul", BLEU, "ptc")}
              {vanne("taux", 398, 62, "Taux autres", BLEU, "pt")}
              {vanne("neg", 500, 62, "CA négoce", BLEU)}
              {vanne("mneg", 564, 62, "Marge", BLEU)}
              {vanne("scan", 690, 62, "CA scan", BLEU)}
              {vanne("hscan", 754, 62, "Heures scan", BLEU)}
              {vanne("struct", 144, 690, "Structure", ORANGE)}
              {vanne("sal", 220, 690, "Salaire k€", ORANGE)}
              {vanne("loyer", 360, 704, "Location k€", ORANGE)}
              {vanne("autres", 520, 704, "Autres k€", ORANGE)}
              {vanne("fees", 680, 704, "Fees %", ORANGE)}
            </svg>
          </section>

          <aside className={s.master} aria-label="Résultat">
            <div className={s.grand}>
              <div className={s.grandL}>Résultat de l’exercice</div>
              <div className={`${s.grandV} ${negatif ? s.neg : ""}`}>
                {a.resultat >= 0 ? "+" : ""}
                {k(a.resultat)}
              </div>
              <div className={s.grandS}>
                {fr(a.marge * 100, 1)} % du CA · {Math.abs(a.resultat - ref.resultat) < 500 ? "comme nos chiffres" : `${a.resultat > ref.resultat ? "+" : "−"}${k(Math.abs(a.resultat - ref.resultat))} face à nos chiffres`}
              </div>
            </div>
            <div className={s.lignes}>
              {(
                [
                  ["Les robinets versent", k(entrees)],
                  ["dont production", k(a.caProd)],
                  ["dont marge négoce", k(margeNeg)],
                  ["dont scan", k(a.caScan)],
                  ["Les fuites vident", k(sorties)],
                  ["Chiffre d’affaires", k(a.ca)],
                  ["Taux de vente moyen", `${fr(a.tauxMoyen, 1)} €/h`],
                  ["Coût d’une heure vendue", `${fr(a.coutHeure, 1)} €/h`],
                  ...(a.caEcrete > 0.5 ? ([["CA écrêté (CLIP)", `−${k(a.caEcrete)}`]] as [string, string][]) : []),
                ] as [string, string][]
              ).map(([lib, val]) => (
                <div key={lib}>
                  <span>{lib}</span>
                  <span className={s.n}>{val}</span>
                  <span />
                </div>
              ))}
            </div>
            <div className={s.actions}>
              <button type="button" className={s.btn} onClick={() => setV(depart.valeurs)} title="Remettre toutes les vannes sur nos chiffres de l’exercice">
                ↺ Revenir à nos chiffres
              </button>
            </div>
            <p className={s.note} style={{ lineHeight: 1.5 }}>
              Même calcul et mêmes chiffres de départ que la console. Les heures payées ({fr(v.heures)} h par personne), les plafonds de taux et le salaire,
              les fees, la location et les autres frais enregistrés se règlent dans la console.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
