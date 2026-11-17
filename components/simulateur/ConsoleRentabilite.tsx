"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Chakra_Petch, Permanent_Marker, Share_Tech_Mono } from "next/font/google";
import s from "./ConsoleRentabilite.module.css";
import { BUS, LEVIERS, PAR_CLE, calcul, type Cle, type Depart, type Levier, type Leviers } from "@/lib/simulateur";

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
  { cle: "taux", libelle: "Taux +5 €/h", vers: (d) => ({ ...d, taux: d.taux + 5 }) },
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
}: {
  l: Levier;
  numero: number;
  couleur: string;
  valeur: number;
  reference: number;
  reel: boolean;
  source: string;
  onChange: (x: number) => void;
}) {
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
        </div>
        <div className={s.capuchon} style={{ bottom: `calc(${PAD}px + ${r} * (100% - ${2 * PAD}px))` }} />
      </div>
      <div style={{ display: "grid", gap: 2, justifyItems: "center" }}>
        <div className={s.nom}>{l.nom}</div>
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
}: {
  depart: Depart;
  versionDepart: string; // change quand l'exercice (ou le mute) change : curseurs et référence repartent des chiffres
  libelleDepart: string;
  entete: ReactNode;
  message?: ReactNode;
  estAdmin: boolean;
  onEnregistrer: (v: Leviers) => Promise<string | null>;
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
      const x = { ...debut };
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
    ["dont production", keur(a.caProd), <Delta key="d" delta={a.caProd - r.caProd} f={keur} />],
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
      ["prod", 1, "1 productif de plus"],
      ["taux", 1, "Taux de vente +1 €/h"],
      ["occ", 1, "Occupation +1 point"],
      ["eff", 1, "Efficience +1 point"],
      ["sal", 1, "Salaire chargé +1 k€ / pers."],
      ["fees", 0.5, "Management fees +0,5 point"],
      ["loyer", 10, "Location +10 k€"],
      ["mneg", 1, "Marge négoce +1 point"],
      ["struct", 1, "1 personne de structure en plus"],
    ] as [Cle, number, string][]
  )
    .map(([k, pas, lib]) => [lib, calcul({ ...v, [k]: v[k] + pas }).resultat - a.resultat] as [string, number])
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const maxAbs = Math.max(...crans.map((c) => Math.abs(c[1])), 1);

  const parametresModifies = (["sal", "fees", "loyer", "autres"] as Cle[]).some((k) => !egal(v[k], depart.valeurs[k]));

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
            {/* COUT_STRUCTURE : le coût d’une heure vendue (console) face au coût horaire de structure saisi dans Rentabilité */}
            <div className={s.vus}>
              <div className={s.vu} title="(salaires + location + autres frais) ÷ heures vendues, + la part des fees : calculé par la console">
                <div className={s.vuTitre}>
                  <span>Coût heure vendue</span>
                </div>
                <div className={s.vuVal}>{fmt(a.coutHeure, 1)} €/h</div>
                <div className={s.echelle}>
                  <span>calculé ici</span>
                </div>
              </div>
              <div className={s.vu} title="Coût horaire de structure de l’exercice, saisi dans la page Rentabilité (utilisé pour les marges)">
                <div className={s.vuTitre}>
                  <span>Coût de structure</span>
                </div>
                <div className={s.vuVal}>{depart.coutStructure !== null ? `${fmt(depart.coutStructure, 1)} €/h` : "—"}</div>
                <div className={s.echelle}>
                  <span>
                    {depart.coutStructure === null
                      ? "non saisi (Rentabilité)"
                      : Math.abs(a.coutHeure - depart.coutStructure) < 0.5
                        ? "saisi : identique"
                        : `saisi · écart ${signe(a.coutHeure - depart.coutStructure, (x) => fmt(x, 1))} €`}
                  </span>
                </div>
              </div>
            </div>
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
                    setRetour(err ? { ok: false, texte: err } : { ok: true, texte: "Salaire, fees, location et autres frais enregistrés comme valeurs de départ de l’exercice." });
                  }}
                >
                  ⬇ Enregistrer comme valeurs de départ
                </button>
                <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  ADMIN : enregistre les 4 tranches Salaire chargé, Mgmt fees, Location, Autres frais{parametresModifies ? " (modifiées)" : ""}.
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
              {LEVIERS.map((l) => (
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
            dérive). <b>CA production</b> = heures vendues × taux de vente, + <b>CA négoce</b> dont on garde la marge. <b>Salaires</b> = (productifs + structure) ×
            salaire chargé moyen. <b>Management fees</b> = % du CA total. <b>Résultat</b> = CA − achats négoce − salaires − fees − loyer − autres frais.{" "}
            <b>Coût d’une heure vendue</b> = (salaires + loyer + autres frais) ÷ heures vendues, + la part de fees. <b>Taux point mort</b> = taux de vente qui donne un
            résultat nul, tout le reste égal.
          </Fragment>
        </section>
      </div>
    </div>
  );
}
