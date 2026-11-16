"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { C, page } from "@/components/pilotage/ui";
import { chargerIndexAffaires, correspondRecherche, scoreRecherche, type EntreeAffaire } from "@/lib/rechercheAffaires";

/* ===============================================================
   CHAMP DE RECHERCHE D'AFFAIRE (RECHERCHE_AFFAIRES)
   Une liste de résultats s'ouvre pendant la frappe : n° de commande ou
   de devis, client, descriptif, trigramme. Flèches haut / bas pour
   choisir, Entrée pour ouvrir, Échap pour fermer.
   Entrée sans résultat choisi : `onSaisieLibre` (ex. un numéro tapé).
================================================================ */

const MAX = 30;
const ETATS: Record<string, string> = { EN_COURS: "en cours", EN_ATTENTE: "intention", LIVREE: "livrée", ABANDONNEE: "abandonnée" };

export default function RechercheAffaire({
  onChoisir,
  onSaisieLibre,
  placeholder = "Rechercher : n° d’affaire ou de devis, client, descriptif, trigramme…",
}: {
  onChoisir: (e: EntreeAffaire) => void;
  onSaisieLibre?: (texte: string) => void;
  placeholder?: string;
}) {
  const [index, setIndex] = useState<EntreeAffaire[] | null>(null);
  const [texte, setTexte] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const idListe = useId();
  const boite = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivant = true;
    chargerIndexAffaires()
      .then((l) => vivant && setIndex(l))
      .catch(() => vivant && setIndex([]));
    return () => {
      vivant = false;
    };
  }, []);

  // un clic ailleurs ferme la liste
  useEffect(() => {
    const fermer = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, []);

  const resultats = useMemo(() => {
    if (!index || !texte.trim()) return [];
    return index
      .filter((e) => correspondRecherche(e.texte, texte))
      .map((e) => ({ e, s: scoreRecherche(e, texte) }))
      .sort((a, b) => b.s - a.s || (a.e.type === b.e.type ? Number(b.e.numero) - Number(a.e.numero) : a.e.type === "CBE" ? -1 : 1))
      .slice(0, MAX)
      .map((x) => x.e);
  }, [index, texte]);

  const choisir = (e: EntreeAffaire) => {
    setTexte("");
    setOuvert(false);
    onChoisir(e);
  };

  return (
    <div ref={boite} style={{ position: "relative", flex: "1 1 420px", maxWidth: 640 }}>
      <input
        type="search"
        role="combobox"
        aria-label="Rechercher une affaire"
        aria-expanded={ouvert && resultats.length > 0}
        aria-controls={idListe}
        aria-activedescendant={ouvert && resultats[actif] ? `${idListe}-${actif}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          setActif(0);
          setOuvert(true);
        }}
        onFocus={() => setOuvert(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOuvert(true);
            setActif((i) => Math.min(i + 1, resultats.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActif((i) => Math.max(i - 1, 0));
          } else if (e.key === "Escape") {
            setOuvert(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (ouvert && resultats[actif]) choisir(resultats[actif]);
            else if (texte.trim() && onSaisieLibre) {
              onSaisieLibre(texte.trim());
              setOuvert(false);
            }
          }
        }}
        style={{ ...page.entrees, width: "100%", minHeight: 44, boxSizing: "border-box" }}
      />

      {ouvert && texte.trim() && (
        <div
          id={idListe}
          role="listbox"
          aria-label="Affaires trouvées"
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#ffffff", border: `1px solid ${C.ligne}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.14)", maxHeight: 420, overflowY: "auto" }}
        >
          {index === null && <div style={{ padding: 12, color: C.gris }}>Chargement de la liste des affaires…</div>}
          {index !== null && resultats.length === 0 && (
            <div style={{ padding: 12, color: C.gris }}>Aucune affaire ne correspond.{onSaisieLibre ? " Entrée : ouvrir ce numéro quand même." : ""}</div>
          )}
          {resultats.map((r, i) => {
            const etat = r.statut ? ETATS[r.statut] : null;
            const pePi = r.imputation === "PE" || r.imputation === "PI" ? r.imputation : null;
            return (
              <div
                key={`${r.type}${r.numero}`}
                id={`${idListe}-${i}`}
                role="option"
                aria-selected={i === actif}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choisir(r);
                }}
                onMouseEnter={() => setActif(i)}
                style={{ padding: "8px 12px", cursor: "pointer", background: i === actif ? "#fbeeee" : undefined, borderBottom: `1px solid ${C.ligne}` }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ color: r.type === "DBE" ? "#8a2c55" : C.rougeFonce, whiteSpace: "nowrap" }}>
                    {r.type} {r.numero}
                  </strong>
                  {r.client && <strong style={{ fontSize: 14 }}>{r.client}</strong>}
                  {pePi && <span style={{ fontSize: 12, fontWeight: 800, color: C.gris }}>{pePi}</span>}
                  {etat && <span style={{ fontSize: 12, color: C.gris }}>· {etat}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: C.gris, whiteSpace: "nowrap" }}>
                    {[r.devis ? `devis DBE ${r.devis}` : "", r.responsable ? `resp. ${r.responsable}` : "", r.redacteur && r.redacteur !== r.responsable ? `réd. ${r.redacteur}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {r.designation && <div style={{ fontSize: 13, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.designation}</div>}
              </div>
            );
          })}
          {resultats.length === MAX && <div style={{ padding: "8px 12px", fontSize: 12, color: C.gris }}>Les {MAX} premiers résultats : précisez la recherche.</div>}
        </div>
      )}
    </div>
  );
}
