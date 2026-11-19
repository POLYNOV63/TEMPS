"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Chakra_Petch, Permanent_Marker, Share_Tech_Mono } from "next/font/google";
import s from "./ConsoleRentabilite.module.css";
import { BUS, LEVIERS, PAR_CLE, PLAFONDS, calcul, type Cle, type Depart, type Levier, type Leviers } from "@/lib/simulateur";

/* ===============================================================
   CONSOLE DE RENTABILITÉ (SIMULATEUR_RENTA)
   Reprise de la maquette validée docs/maquettes/console-rentabilite.html :
   une tranche (fader) par levier, un bloc Master, des scènes, une référence
   mémorisée, la répartition de chaque euro de CA et « ce que rapporte un cran ».
   Différences voulues : les curseurs démarrent sur NOS chiffres (prop
   `depart`), la référence de départ = ces chiffres, les scènes partent
   d'eux ; pas de mémoire du navigateur ; un voyant vert sous chaque tranche
   dit si la valeur vient de nos chiffres (sinon : valeur d'exemple).
================================================================ */

const fUi = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--f-ui" });
const fLcd = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--f-lcd" });
const fTape = Permanent_Marker({ subsets: ["latin"], weight: "400", variable: "--f-tape" });

const fmt = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const keur = (n: number) => `${fmt(n / 1000)} k€`;
const signe = (n: number, f: (x: number) => string) => (Math.abs(n) < 1e-9 ? "±0" : (n > 0 ? "+" : "−") + f(Math.abs(n)));
const PAD = 10;
const ratio = (l: Levier, x: number) => (x - l.min) / (l.max - l.min);
const borner = (l: Levier, x: number) => {
  const r = Math.round((Math.min(l.max, Math.max(l.min, x)) - l.min) / l.pas) * l.pas + l.min;
  return Number(r.toFixed(4));
};
const egal = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const SCENES: { cle: string; libelle: string; vers: (d: Leviers) => Leviers }[] = [
  { cle: "type", libelle: "Nos chiffres", vers: (d) => ({ ...d }) },
  { cle: "embauche", libelle: "+2 embauches", vers: (d) => ({ ...d, prod: d.prod + 2 }) },
  { cle: "taux", libelle: "Taux +5 €/h", vers: (d) => ({ ...d, tcalc: d.tcalc + 5, taux: d.taux + 5 }) },
  { cle: "derive", libelle: "Dérive 10 %", vers: (d) => ({ ...d, eff: Math.round(d.eff * 0.9) }) },
  { cle: "fees", libelle: "Fees 8 %", vers: (d) => ({ ...d, fees: 8 }) },
];

/* ---------------- une tranche ---------------- */
function Tranche({
  l,
  numero,
  couleur,
  valeur,
  reference,
  reel,
  source,
  onChange,
  plafond,
  onPlafond,
}: {
  l: Levier;
  numero: number;
  couleur: string;
  valeur: number;
  reference: number;
  reel: boolean;
  source: string;
  onChange: (x: number) => void;
  plafond?: number; // DEUX_TAUX : plafond marché (voyant CLIP au-delà)
  onPlafond?: (x: number) => void;
}) {
  const [saisiePlafond, setSaisiePlafond] = useState<string | null>(null);
  const clip = plafond !== undefined && valeur > plafond + 1e-9;
  const fader = useRef<HTMLDivElement>(null);
  const [saisie, setSaisie] = useState<string | null>(null);
  const derniere = useRef({ valeur, onChange });
  derniere.current = { valeur, onChange };

  // molette : écouteur non passif (React ne permet pas d'empêcher le défilement de la page)
  useEffect(() => {
    const el = fader.current;
    if (!el) return;
    const h = (ev: WheelEvent) => {
      ev.preventDefault();
      derniere.current.onChange(derniere.current.valeur + (ev.deltaY < 0 ? l.pas : -l.pas));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [l.pas]);

  const depuisY = (clientY: number) => {
    const r = fader.current?.getBoundingClientRect();
    if (!r) return;
    const x = 1 - (clientY - r.top - PAD) / (r.height - 2 * PAD);
    onChange(l.min + x * (l.max - l.min));
  };
  const valider = () => {
    if (saisie === null) return;
    const x = Number(saisie.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(x)) onChange(x);
    setSaisie(null);
  };
  const r = ratio(l, valeur);
  const rr = ratio(l, reference);
  const ecart = valeur - reference;
  const varC = { "--c": couleur } as CSSProperties;

  return (
    <div className={s.tranche} style={varC} title={l.aide ? `${l.aide}\n${source}` : source}>
      <div className={s.num}>
        CH {String(numero).padStart(2, "0")}
        <span className={`${s.led} ${Math.abs(ecart) > 1e-9 ? s.ledOn : ""}`} aria-hidden="true" />
        {plafond !== undefined && (
          <span className={`${s.clip} ${clip ? s.clipOn : ""}`} title={clip ? "CLIP : au-delà du plafond marché, le CA est écrêté" : "Sous le plafond marché"}>
            CLIP
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 5, justifyItems: "center", width: "100%" }}>
        <input
          className={s.lcd}
          inputMode="decimal"
          aria-label={`${l.nom} (${l.u})`}
          value={saisie ?? fmt(valeur, l.dec)}
          onFocus={() => setSaisie(fmt(valeur, l.dec))}
          onChange={(e) => setSaisie(e.target.value)}
          onBlur={valider}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setSaisie(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <div className={s.unite}>{l.u}</div>
      </div>
      <div
        ref={fader}
        className={s.fader}
        role="slider"
        tabIndex={0}
        aria-label={l.nom}
        aria-valuemin={l.min}
        aria-valuemax={l.max}
        aria-valuenow={valeur}
        aria-valuetext={`${fmt(valeur, l.dec)} ${l.u}`}
        onPointerDown={(ev) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          depuisY(ev.clientY);
          ev.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={(ev) => {
          if (ev.currentTarget.hasPointerCapture(ev.pointerId)) depuisY(ev.clientY);
        }}
        onDoubleClick={() => onChange(reference)}
        onKeyDown={(ev) => {
          const gros = (l.max - l.min) / 10;
          const m = ({ ArrowUp: l.pas, ArrowRight: l.pas, ArrowDown: -l.pas, ArrowLeft: -l.pas, PageUp: gros, PageDown: -gros } as Record<string, number>)[ev.key];
          if (m !== undefined) {
            ev.preventDefault();
            onChange(valeur + m);
          }
          if (ev.key === "Home") {
            ev.preventDefault();
            onChange(l.min);
          }
          if (ev.key === "End") {
            ev.preventDefault();
            onChange(l.max);
          }
        }}
      >
        <div className={s.rail} />
        <div className={s.rempli} style={{ height: `calc(${r} * (100% - ${2 * PAD}px))` }} />
        <div className={s.grad}>
          {Array.from({ length: 11 }, (_, i) => (
            <i key={i} style={{ bottom: `${i * 10}%` }} />
          ))}
          <i className={s.ref} style={{ bottom: `calc(${rr * 100}% - 1px)` }} />
          {plafond !== undefined && plafond >= l.min && plafond <= l.max && <i className={s.plafond} style={{ bottom: `calc(${ratio(l, plafond) * 100}% - 1px)` }} />}
        </div>
        <div className={s.capuchon} style={{ bottom: `calc(${PAD}px + ${r} * (100% - ${2 * PAD}px))` }} />
      </div>
      <div style={{ display: "grid", gap: 2, justifyItems: "center" }}>
        <div className={s.nom}>{l.nom}</div>
        {plafond !== undefined && onPlafond && (
          <label className={s.plafondSaisie} title="Plafond marché : au-delà, le client ne suit pas ; le CA est écrêté">
            plafond
            <input
              className={s.lcd}
              style={{ fontSize: 12, padding: "2px", color: "#ff8a7a" }}
              inputMode="decimal"
              aria-label={`Plafond marché, ${l.nom} (€ / h)`}
              value={saisiePlafond ?? fmt(plafond, 1)}
              onFocus={() => setSaisiePlafond(fmt(plafond, 1))}
              onChange={(e) => setSaisiePlafond(e.target.value)}
              onBlur={() => {
                const x = Number((saisiePlafond ?? "").replace(/\s/g, "").replace(",", "."));
                if (saisiePlafond !== null && Number.isFinite(x) && x > 0) onPlafond(x);
                setSaisiePlafond(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        )}
        <div className={s.delta} style={{ color: Math.abs(ecart) > 1e-9 ? "var(--lcd)" : undefined }}>
          {Math.abs(ecart) > 1e-9 ? signe(ecart, (a) => fmt(a, l.dec)) : ""}
        </div>
        <span className={reel ? s.reel : s.exemple} title={reel ? "Nos chiffres" : "Valeur d’exemple"} aria-label={reel ? "nos chiffres" : "valeur d’exemple"} />
      </div>
    </div>
  );
}

/* ---------------- vumètre ---------------- */
function Vu({ valeur, min, max, couleurDe }: { valeur: number; min: number; max: number; couleurDe: (x: number) => "v" | "j" | "r" }) {
  const nbOn = Math.round(Math.max(0, Math.min(1, (valeur - min) / (max - min))) * 16);
  return (
    <div className={s.leds} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} className={i < nbOn ? s[couleurDe(min + ((i + 0.5) / 16) * (max - min))] : undefined} />
      ))}
    </div>
  );
}

/* ---------------- cadran à aiguille (CADRAN_COUT) ----------------
   L'aiguille = le coût d'une heure vendue (résultat de la console) ; le repère orange = le taux de vente ;
   à gauche du taux, zone verte (on vend l'heure plus cher qu'elle ne coûte), à droite, zone rouge (on perd).
   Le trait pointillé = le coût de structure saisi dans Rentabilité. L'échelle suit la référence (elle ne bouge pas
   pendant qu'on joue avec les faders). */
function Cadran({ cout, taux, structure, echelleSur }: { cout: number; taux: number; structure: number | null; echelleSur: number }) {
  const min = Math.max(0, Math.floor((echelleSur * 0.4) / 10) * 10);
  const max = Math.ceil((echelleSur * 1.6) / 10) * 10;
  const W = 300;
  const cx = 150;
  const cy = 150;
  const R = 118;
  const t = (x: number) => Math.max(0, Math.min(1, (x - min) / (max - min)));
  const pt = (x: number, r: number) => {
    const a = Math.PI * (1 - t(x));
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (de: number, a: number, r: number) => {
    const [x1, y1] = pt(de, r);
    const [x2, y2] = pt(a, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const graduations = Array.from({ length: 9 }, (_, i) => min + ((max - min) * i) / 8);
  const angle = -90 + 180 * t(cout);
  const margeH = taux - cout;
  const [tx1, ty1] = pt(taux, R - 16);
  const [tx2, ty2] = pt(taux, R + 10);
  const [lx, ly] = pt(taux, R + 22);
  return (
    <div className={s.vu} style={{ padding: "8px 8px 10px" }}>
      <div className={s.vuTitre}>
        <span>Coût d’une heure vendue</span>
        <span style={{ color: margeH >= 0 ? "var(--vert)" : "var(--perte)" }}>{margeH >= 0 ? "on gagne" : "on perd"}</span>
      </div>
      <svg viewBox={`0 0 ${W} 172`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label={`Une heure vendue coûte ${fmt(cout, 1)} € et se vend ${fmt(taux, 1)} € : ${margeH >= 0 ? "marge" : "perte"} de ${fmt(Math.abs(margeH), 1)} € par heure`}>
        <path d={arc(min, Math.min(taux, max), R)} fill="none" stroke="var(--vert)" strokeWidth={14} opacity={0.75} />
        <path d={arc(Math.max(taux, min), max, R)} fill="none" stroke="var(--perte)" strokeWidth={14} opacity={0.75} />
        {graduations.map((g, i) => {
          const [x1, y1] = pt(g, R - 12);
          const [x2, y2] = pt(g, R - 22);
          const [xl, yl] = pt(g, R - 36);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9aa1a8" strokeWidth={1.5} />
              {i % 2 === 0 && (
                <text x={xl} y={yl + 4} fill="#9aa1a8" fontSize={11} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
                  {fmt(g)}
                </text>
              )}
            </g>
          );
        })}
        {structure !== null && structure >= min && structure <= max && (() => {
          const [a1, b1] = pt(structure, R - 9);
          const [a2, b2] = pt(structure, R + 9);
          return <line x1={a1} y1={b1} x2={a2} y2={b2} stroke="#e9e6df" strokeWidth={2} strokeDasharray="3 2" />;
        })()}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--lcd)" strokeWidth={3} />
        <text x={lx} y={ly + 2} fill="var(--lcd)" fontSize={11} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
          taux {fmt(taux)}
        </text>
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: "transform .35s cubic-bezier(.3,1.4,.5,1)" }}>
          <line x1={cx} y1={cy + 10} x2={cx} y2={cy - R + 6} stroke="#ff8a3d" strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={9} fill="#2b3035" stroke="#5a6168" strokeWidth={2} />
        <text x={cx} y={cy - 34} fill="var(--lcd)" fontSize={22} textAnchor="middle" style={{ fontFamily: "var(--f-lcd), monospace" }}>
          {fmt(cout, 1)} €/h
        </text>
      </svg>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.45 }}>
        Une heure vendue coûte <b style={{ color: "var(--lcd)" }}>{fmt(cout, 1)} €</b>, elle se vend <b style={{ color: "var(--lcd)" }}>{fmt(taux, 1)} €</b> :{" "}
        <b style={{ color: margeH >= 0 ? "var(--vert)" : "var(--perte)" }}>
          {margeH >= 0 ? "+" : "−"}
          {fmt(Math.abs(margeH), 1)} € par heure
        </b>
        .
        <br />
        <span style={{ display: "inline-block", width: 14, borderTop: "2px dashed #e9e6df", verticalAlign: "middle", marginRight: 5 }} />
        coût de structure saisi (Rentabilité) : {structure !== null ? `${fmt(structure, 1)} €/h` : "non saisi"}
        {structure !== null && <> · écart {signe(cout - structure, (x) => fmt(x, 1))} €</>}
      </div>
    </div>
  );
}

const Delta = ({ delta, f, inverse }: { delta: number; f: (x: number) => string; inverse?: boolean }) => {
  const cls = Math.abs(delta) < 0.5 ? s.dz : delta > 0 !== Boolean(inverse) ? s.dp : s.dm;
  return <span className={`${s.d} ${cls}`}>{Math.abs(delta) < 0.5 ? "—" : signe(delta, f)}</span>;
};

/* ---------------- la console ---------------- */
export default function ConsoleRentabilite({
  depart,
  versionDepart,
  libelleDepart,
  entete,
  message,
  estAdmin,
  onEnregistrer,
  caReel = null,
}: {
  depart: Depart;
  versionDepart: string; // change quand l'exercice (ou le mute) change : curseurs et référence repartent des chiffres
  libelleDepart: string;
  entete: ReactNode;
  message?: ReactNode;
  estAdmin: boolean;
  onEnregistrer: (v: Leviers) => Promise<string | null>;
  caReel?: number | null; // CA_REEL_EXERCICE : CA réalisé de l'exercice (Finances), la cible
}) {
  const [v, setV] = useState<Leviers>(depart.valeurs);
  const [ref, setRef] = useState<Leviers>(depart.valeurs);
  const [libRef, setLibRef] = useState(libelleDepart);
  const [scene, setScene] = useState("type");
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const vCourant = useRef(v);
  vCourant.current = v;
  const anim = useRef(0);

  const allerVers = useCallback((cible: Leviers) => {
    cancelAnimationFrame(anim.current);
    const debut = { ...vCourant.current };
    const t0 = performance.now();
    const reduit = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duree = reduit ? 0 : 650;
    const pas = (t: number) => {
      const p = duree ? Math.min(1, (t - t0) / duree) : 1;
      const e = 1 - Math.pow(1 - p, 3);
      const x = { ...cible, ...debut, ptc: cible.ptc, pt: cible.pt };
      for (const l of LEVIERS) x[l.k] = p < 1 ? debut[l.k] + (cible[l.k] - debut[l.k]) * e : cible[l.k];
      setV(x);
      if (p < 1) anim.current = requestAnimationFrame(pas);
    };
    anim.current = requestAnimationFrame(pas);
  }, []);

  // nouvel exercice (ou mute) : les curseurs rejoignent nos chiffres, qui deviennent la référence
  useEffect(() => {
    setRef(depart.valeurs);
    setLibRef(libelleDepart);
    setScene("type");
    allerVers(depart.valeurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionDepart]);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  const regler = (k: Cle, x: number) => {
    cancelAnimationFrame(anim.current);
    setV((p) => ({ ...p, [k]: borner(PAR_CLE[k], x) }));
  };

  const a = calcul(v);
  const r = calcul(ref);
  const dR = a.resultat - r.resultat;
  let numero = 0;

  const lignes: [string, string, ReactNode][] = [
    ["Chiffre d’affaires", keur(a.ca), <Delta key="d" delta={a.ca - r.ca} f={keur} />],
    ...(caReel !== null
      ? ([["CA réel de l’exercice (Finances)", keur(caReel), <span key="d" className={s.d}>simulé {a.ca - caReel >= 0 ? "+" : "−"}{keur(Math.abs(a.ca - caReel))}</span>]] as [string, string, ReactNode][])
      : []),
    ["dont production", keur(a.caProd), <Delta key="d" delta={a.caProd - r.caProd} f={keur} />],
    ["dont négoce", keur(a.caNeg), <Delta key="d" delta={a.caNeg - r.caNeg} f={keur} />],
    ["dont scan", keur(a.caScan), <Delta key="d" delta={a.caScan - r.caScan} f={keur} />],
    ["Taux de vente moyen", `${fmt(a.tauxMoyen, 1)} €/h`, <Delta key="d" delta={(a.tauxMoyen - r.tauxMoyen) * 10} f={(x) => `${fmt(x / 10, 1)} €`} />],
    ...(a.caEcrete > 0.5
      ? ([["CA écrêté (CLIP)", `−${keur(a.caEcrete)}`, <span key="d" className={`${s.d} ${s.dm}`}>au-delà des plafonds</span>]] as [string, string, ReactNode][])
      : []),
    ["Heures vendues", `${fmt(a.hVendues)} h`, <Delta key="d" delta={a.hVendues - r.hVendues} f={(x) => `${fmt(x)} h`} />],
    ["CA par personne", keur(a.caParPers), <Delta key="d" delta={a.caParPers - r.caParPers} f={keur} />],
    ["Salaires", keur(a.salaires), <Delta key="d" delta={a.salaires - r.salaires} f={keur} inverse />],
    ["Coût d’une heure vendue", `${fmt(a.coutHeure, 1)} €/h`, <Delta key="d" delta={(a.coutHeure - r.coutHeure) * 10} f={(x) => `${fmt(x / 10, 1)} €`} inverse />],
    [
      "Taux de vente point mort",
      Number.isFinite(a.tauxPM) ? `${fmt(a.tauxPM, 1)} €/h` : "—",
      Number.isFinite(a.tauxPM) && Number.isFinite(r.tauxPM) ? <Delta key="d" delta={(a.tauxPM - r.tauxPM) * 10} f={(x) => `${fmt(x / 10, 1)} €`} inverse /> : null,
    ],
    ["CA point mort", Number.isFinite(a.caPM) ? keur(a.caPM) : "—", Number.isFinite(a.caPM) && Number.isFinite(r.caPM) ? <Delta key="d" delta={a.caPM - r.caPM} f={keur} inverse /> : null],
    ["Un productif de plus", `${a.parProductif < 0 ? "−" : "+"}${keur(Math.abs(a.parProductif))}`, null],
  ];

  const postes: [string, number, string][] = [
    ["Achats négoce", a.achats, "var(--bus-negoce)"],
    ["Salaires", a.salaires, "var(--bus-equipe)"],
    ["Mgmt fees", a.fees, "var(--bus-structure)"],
    ["Location", a.loyer, "#5d6670"],
    ["Autres frais", a.autres, "#454c54"],
  ];
  const couts = postes.reduce((t, p) => t + p[1], 0);
  const base = Math.max(a.ca, couts, 1);
  const parts = a.resultat >= 0 ? [...postes, ["Résultat", a.resultat, "var(--vert)"] as [string, number, string]] : postes;

  const crans = (
    [
      ["calc", 1, "1 productif Calcul de plus"],
      ["prod", 1, "1 autre productif de plus"],
      ["tcalc", 1, "Taux Calcul +1 €/h"],
      ["taux", 1, "Taux autres +1 €/h"],
      ["occ", 1, "Occupation +1 point"],
      ["eff", 1, "Efficience +1 point"],
      ["sal", 1, "Salaire chargé +1 k€ / pers."],
      ["fees", 0.5, "Management fees +0,5 point"],
      ["loyer", 10, "Location +10 k€"],
      ["mneg", 1, "Marge négoce +1 point"],
      ["scan", 10, "CA scan +10 k€"],
      ["struct", 1, "1 personne de structure en plus"],
    ] as [Cle, number, string][]
  )
    .map(([k, pas, lib]) => [lib, calcul({ ...v, [k]: v[k] + pas }).resultat - a.resultat] as [string, number])
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const maxAbs = Math.max(...crans.map((c) => Math.abs(c[1])), 1);

  const parametresModifies = (["sal", "fees", "loyer", "autres", "ptc", "pt"] as Cle[]).some((k) => !egal(v[k], depart.valeurs[k]));

  return (
    <div className={`${s.fond} ${fUi.variable} ${fLcd.variable} ${fTape.variable}`}>
      <div className={s.console}>
        <header className={s.tete}>
          <div className={s.marque}>
            <h1>
              <b>●</b> Simulateur de rentabilité
            </h1>
            <span>POLYNOV · bureau d’études · un exercice (nov. → oct.)</span>
          </div>
          {entete}
        </header>
        <div className={s.tete}>
          <div className={s.scenes} role="group" aria-label="Scènes">
            <span className={s.lbl}>Scènes</span>
            {SCENES.map((sc) => (
              <button
                key={sc.cle}
                type="button"
                className={`${s.btn} ${scene === sc.cle ? s.on : ""}`}
                onClick={() => {
                  setScene(sc.cle);
                  allerVers(sc.vers(depart.valeurs));
                }}
              >
                {sc.libelle}
              </button>
            ))}
          </div>
        </div>
        <p className={s.note}>
          Les curseurs démarrent sur <b>nos chiffres</b> de l’exercice (voyant vert sous la tranche ; cercle vide = valeur d’exemple, à saisir). Glisser le curseur,
          molette, flèches du clavier, ou taper la valeur dans l’afficheur ; double-clic : retour à la référence. Le repère orange sur chaque rail = la <b>référence</b>.
        </p>
        {message}

        <div className={s.plateau}>
          <section className={s.table} aria-label="Table de mixage des leviers">
            <div className={s.busLigne}>
              {BUS.map((b) => (
                <div key={b.nom} className={s.bus}>
                  <div className={s.ruban}>{b.nom}</div>
                  <div className={s.tranches} style={{ "--c": b.c } as CSSProperties}>
                    {b.leviers.map((l) => {
                      numero++;
                      return (
                        <Tranche
                          key={l.k}
                          l={l}
                          numero={numero}
                          couleur={b.c}
                          valeur={v[l.k]}
                          reference={ref[l.k]}
                          reel={depart.sources[l.k]?.reel ?? false}
                          source={depart.sources[l.k]?.texte ?? ""}
                          onChange={(x) => regler(l.k, x)}
                          plafond={PLAFONDS[l.k] ? v[PLAFONDS[l.k]!] : undefined}
                          onPlafond={PLAFONDS[l.k] ? (x) => setV((p) => ({ ...p, [PLAFONDS[l.k]!]: Math.round(x * 2) / 2 })) : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className={s.master} aria-label="Résultat">
            <h2>
              <span>
                <b>■</b> Master
              </span>
              <span style={{ fontSize: 10, letterSpacing: ".12em" }}>{libRef}</span>
            </h2>
            <div className={s.grand}>
              <div className={s.grandL}>Résultat de l’exercice</div>
              <div className={`${s.grandV} ${a.resultat < 0 ? s.neg : ""}`}>
                {a.resultat < 0 ? "−" : ""}
                {keur(Math.abs(a.resultat))}
              </div>
              <div className={s.grandS}>
                {fmt(a.marge * 100, 1)} % du CA · {Math.abs(dR) < 500 ? "comme la référence" : `${signe(dR, keur)} face à la référence`}
              </div>
            </div>
            {/* CADRAN_COUT : le coût d’une heure vendue face au taux de vente et au coût de structure saisi */}
            <Cadran cout={a.coutHeure} taux={a.tauxMoyen} structure={depart.coutStructure} echelleSur={Math.max(r.tauxMoyen, r.coutHeure, 1)} />
            <div className={s.vus}>
              <div className={s.vu}>
                <div className={s.vuTitre}>
                  <span>Marge nette</span>
                </div>
                <Vu valeur={a.marge * 100} min={-15} max={15} couleurDe={(x) => (x < 0 ? "r" : x < 5 ? "j" : "v")} />
                <div className={s.echelle}>
                  <span>-15%</span>
                  <span>0</span>
                  <span>+15%</span>
                </div>
                <div className={s.vuVal}>{fmt(a.marge * 100, 1)} %</div>
              </div>
              <div className={s.vu}>
                <div className={s.vuTitre}>
                  <span>Salaires / CA</span>
                </div>
                <Vu valeur={a.masseCA * 100} min={40} max={100} couleurDe={(x) => (x < 65 ? "v" : x < 75 ? "j" : "r")} />
                <div className={s.echelle}>
                  <span>40%</span>
                  <span>70%</span>
                  <span>100%</span>
                </div>
                <div className={s.vuVal}>{fmt(a.masseCA * 100, 1)} %</div>
              </div>
            </div>
            <div className={s.lignes}>
              {lignes.map(([lib, val, d]) => (
                <div key={lib}>
                  <span>{lib}</span>
                  <span className={s.n}>{val}</span>
                  {d ?? <span className={`${s.d} ${s.dz}`} />}
                </div>
              ))}
            </div>
            <div className={s.actions}>
              <button
                type="button"
                className={`${s.btn} ${s.rec}`}
                title="La position actuelle devient la référence (repères orange, écarts)"
                onClick={() => {
                  setRef({ ...v });
                  setLibRef("réf. : réglage mémorisé");
                }}
              >
                ● Mémoriser la réf.
              </button>
              <button type="button" className={s.btn} title="Remettre tous les curseurs sur la référence" onClick={() => allerVers({ ...ref })}>
                ↺ Revenir à la réf.
              </button>
            </div>
            {estAdmin && (
              <div style={{ display: "grid", gap: 6 }}>
                <button
                  type="button"
                  className={s.btn}
                  disabled={enCours}
                  title="Enregistre salaire chargé, management fees, location et autres frais de cette position comme valeurs de départ de l’exercice"
                  onClick={async () => {
                    setEnCours(true);
                    setRetour(null);
                    const err = await onEnregistrer(v);
                    setEnCours(false);
                    setRetour(err ? { ok: false, texte: err } : { ok: true, texte: "Salaire, fees, location, autres frais et plafonds enregistrés comme valeurs de départ de l’exercice." });
                  }}
                >
                  ⬇ Enregistrer comme valeurs de départ
                </button>
                <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  ADMIN : enregistre Salaire chargé, Mgmt fees, Location, Autres frais et les deux plafonds de taux{parametresModifies ? " (modifiés)" : ""}.
                </span>
                {retour && <div className={`${s.message} ${retour.ok ? "" : s.erreur}`}>{retour.texte}</div>}
              </div>
            )}
          </aside>
        </div>

        <div className={s.bas}>
          <section className={s.module}>
            <h3>Où part chaque euro de CA</h3>
            <p className={s.aide}>
              Le chiffre d’affaires de gauche à droite : achats du négoce, salaires, management fees, loyer, autres frais, et ce qui reste. Si les coûts dépassent le CA, la
              partie rouge est la perte.
            </p>
            <div className={s.cascade} style={{ boxShadow: a.resultat < 0 ? "inset 0 0 0 2px var(--perte)" : undefined }}>
              {parts.map(([lib, x, c]) => (
                <div key={lib} style={{ flex: `0 0 ${(x / base) * 100}%`, background: c }} title={`${lib} : ${keur(x)}`}>
                  {x / base > 0.09 ? lib : ""}
                </div>
              ))}
            </div>
            <div className={s.legende}>
              {parts.map(([lib, x, c]) => (
                <span key={lib}>
                  <i style={{ background: c }} />
                  {lib} <b>{keur(x)}</b> · {fmt((x / Math.max(a.ca, 1)) * 100, 0)} %
                </span>
              ))}
              {a.resultat < 0 && (
                <span>
                  <i style={{ background: "var(--perte)" }} />
                  Perte <b>{keur(-a.resultat)}</b> : les coûts dépassent le CA de {fmt((-a.resultat / Math.max(a.ca, 1)) * 100, 1)} %
                </span>
              )}
            </div>
          </section>
          <section className={s.module}>
            <h3>Ce que rapporte un cran</h3>
            <p className={s.aide}>Effet sur le résultat de l’exercice d’un petit mouvement de chaque curseur, à partir de la position actuelle. Les plus puissants en haut.</p>
            <table className={s.sens}>
              <tbody>
                {crans.map(([lib, d]) => (
                  <tr key={lib}>
                    <td>
                      {lib}
                      <div className={`${s.barre} ${d < 0 ? s.barreM : ""}`} style={{ width: `${(Math.abs(d) / maxAbs) * 100}%` }} />
                    </td>
                    <td style={{ color: d < 0 ? "var(--perte)" : "var(--vert)" }}>{signe(d, keur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className={s.module}>
          <h3 style={{ marginBottom: 8 }}>D’où viennent les chiffres de départ</h3>
          <table className={s.sources}>
            <tbody>
              {[...LEVIERS, { k: "ptc" as Cle, nom: "Plafond Calcul", u: "€ / h", dec: 1 }, { k: "pt" as Cle, nom: "Plafond autres", u: "€ / h", dec: 1 }].map((l) => (
                <tr key={l.k}>
                  <td>
                    <span className={depart.sources[l.k]?.reel ? s.reel : s.exemple} style={{ marginRight: 6 }} />
                    {l.nom}
                  </td>
                  <td>
                    {fmt(depart.valeurs[l.k], l.dec)} {l.u}
                  </td>
                  <td style={{ color: "var(--ink-dim)" }}>{depart.sources[l.k]?.texte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`${s.module} ${s.pied}`}>
          <h3 style={{ marginBottom: 8 }}>Comment la console calcule</h3>
          <Fragment>
            <b>Heures payées</b> = productifs × heures annuelles (1 607 h = 35 h). <b>Heures passées sur affaires</b> = heures payées × taux d’occupation (le reste :
            devis, commercial, formation, NI…). <b>Heures vendues</b> = heures passées × efficience (au-dessus de 100 % : on fait mieux que le chiffré ; en dessous :
            dérive). <b>CA production</b> = heures vendues des productifs Calcul × taux Calcul + celles des autres × taux autres, chaque taux écrêté à son <b>plafond marché</b> (voyant CLIP), + <b>CA négoce</b> dont on garde la marge, + <b>CA scan</b> (tout le scan, net d’achats), dont les <b>heures</b> sont retirées des heures de production. <b>Salaires</b> = (productifs + structure) ×
            salaire chargé moyen. <b>Management fees</b> = % du CA total. <b>Résultat</b> = CA − achats négoce − salaires − fees − loyer − autres frais.{" "}
            <b>Coût d’une heure vendue</b> = (salaires + loyer + autres frais) ÷ heures vendues, + la part de fees. <b>Taux point mort</b> = taux de vente qui donne un
            résultat nul, tout le reste égal.
          </Fragment>
        </section>
      </div>
    </div>
  );
}
