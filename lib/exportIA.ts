import fs from "fs";
import path from "path";

/* ===============================================================
   EXPORT IA - MOTEUR

   Construit le fichier de contexte POLYNOV destiné à une IA.

   Principes :
     - AUCUN secret : les fichiers .env ne sont jamais lus et toute
       valeur ressemblant à une clé, un jeton ou un mot de passe est
       masquée dans tout le contenu exporté (code, SQL, documents).
     - Taille maîtrisée : deux modes.
         "leger"   (~200 Ko) : contexte métier, structure Supabase
                   condensée, carte du code, code des petits fichiers
                   et résumé des gros (styles retirés).
         "complet" (~1 Mo)   : code intégral dans la limite du budget.
     - Les emails sont remplacés par [EMAIL] (données personnelles).

   Ce module ne dépend que de Node (fs, path) : il est testable
   en dehors de Next.js.
================================================================ */

export type ModeExport = "leger" | "complet";

export type StatsExport = {
  mode: ModeExport;
  octets: number;
  fichiersTrouves: number;
  complets: number;
  resumes: number;
  omis: number;
  secretsMasques: number;
  emailsMasques: number;
  lignesStylesRetirees: number;
  avertissement: string | null;
};

type Profil = {
  budgetTotal: number;
  tailleMaxFichier: number;
  retirerStyles: boolean;
  corpsFonctionMax: number;
  contexteManuelMax: number;
  resumeMax: number;
};

export const PROFILS: Record<ModeExport, Profil> = {
  leger: {
    budgetTotal: 260_000,
    tailleMaxFichier: 30_000,
    retirerStyles: true,
    corpsFonctionMax: 1_500,
    contexteManuelMax: 30_000,
    resumeMax: 4_500,
  },
  complet: {
    budgetTotal: 1_150_000,
    tailleMaxFichier: 220_000,
    retirerStyles: false,
    corpsFonctionMax: 6_000,
    contexteManuelMax: 60_000,
    resumeMax: 8_000,
  },
};

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".css", ".md"]);
const JSON_AUTORISES = new Set(["package.json", "tsconfig.json"]);

const DOSSIERS_EXCLUS = new Set([
  ".next",
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "build",
  "public",
  ".vercel",
  ".vscode",
  ".idea",
  "scripts",
]);

const FICHIERS_LOCKS = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

/* Noms de fichiers jamais exportés. */
const NOMS_SENSIBLES =
  /(^\.env)|(\.pem$)|(\.key$)|(\.p12$)|(\.pfx$)|secret|credential|service[-_]?account|(^audit-projet)|AI_CONTEXT/i;

/* ===============================================================
   MASQUAGE DES SECRETS
================================================================ */

export type Masquage = { secrets: number; emails: number };

const MOTIFS_SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
];

const MOTIF_BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/g;
const MOTIF_URL_IDENTIFIANTS = /(https?:\/\/)[^\s/:@"']+:[^\s/@"']+@/g;
const MOTIF_URL_SUPABASE = /https:\/\/[a-z0-9]{15,30}\.supabase\.co/gi;

/* password: "xxx", apiKey = 'xxx', client_secret: `xxx` ... */
const MOTIF_AFFECTATION =
  /((?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key|access[_-]?key|authorization)[A-Za-z0-9_]*["']?\s*[:=]\s*)(["'`])([^"'`\n]{6,})\2/gi;

const MOTIF_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function masquer(texte: string, m: Masquage): string {
  let r = texte;

  for (const motif of MOTIFS_SECRETS) {
    r = r.replace(motif, () => {
      m.secrets++;
      return "[SECRET_MASQUE]";
    });
  }

  r = r.replace(MOTIF_BEARER, (_tout, mot: string) => {
    m.secrets++;
    return `${mot} [SECRET_MASQUE]`;
  });

  r = r.replace(MOTIF_URL_IDENTIFIANTS, (_tout, debut: string) => {
    m.secrets++;
    return `${debut}[IDENTIFIANTS_MASQUES]@`;
  });

  r = r.replace(MOTIF_URL_SUPABASE, () => "https://[PROJET].supabase.co");

  r = r.replace(MOTIF_AFFECTATION, (_tout, debut: string, guillemet: string) => {
    m.secrets++;
    return `${debut}${guillemet}[SECRET_MASQUE]${guillemet}`;
  });

  r = r.replace(MOTIF_EMAIL, () => {
    m.emails++;
    return "[EMAIL]";
  });

  return r;
}

/* ===============================================================
   COMPACTAGE DU CODE
================================================================ */

/* Retire les gros objets de styles (const styles = { ... };) */
export function retirerBlocsStyles(source: string): { texte: string; retirees: number } {
  const lignes = source.split("\n");
  const sortie: string[] = [];
  let retirees = 0;

  for (let i = 0; i < lignes.length; i++) {
    if (/^const styles\b/.test(lignes[i])) {
      let debutCorps = i;

      while (debutCorps < lignes.length && debutCorps < i + 8 && !/=\s*\{\s*$/.test(lignes[debutCorps])) {
        debutCorps++;
      }

      if (debutCorps < lignes.length && /=\s*\{\s*$/.test(lignes[debutCorps])) {
        let fin = debutCorps + 1;

        while (fin < lignes.length && !/^\};?\s*$/.test(lignes[fin])) {
          fin++;
        }

        if (fin < lignes.length) {
          const nb = fin - i + 1;
          retirees += nb;
          sortie.push(`/* styles omis (${nb} lignes) */`);
          i = fin;
          continue;
        }
      }
    }

    sortie.push(lignes[i]);
  }

  return { texte: sortie.join("\n"), retirees };
}

export function compacterSource(source: string, retirerStyles: boolean) {
  let texte = source.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  let retirees = 0;

  if (retirerStyles) {
    const r = retirerBlocsStyles(texte);
    texte = r.texte;
    retirees = r.retirees;
  }

  texte = texte.replace(/\n{3,}/g, "\n\n").trim();

  return { texte, retirees };
}

function joindreImports(source: string) {
  return source.replace(
    /^import\s+[\w*\s,{}]+?\s+from\s+["'][^"']+["'];?/gm,
    (bloc) => bloc.replace(/\s+/g, " ")
  );
}

/* Résumé d'un gros fichier : imports, signatures, accès aux données. */
export function resumerFichier(source: string, tailleMax: number): string {
  const lignes = joindreImports(source).split("\n");
  const gardees: string[] = [];

  const aGarder = (l: string) =>
    /^import\s/.test(l) ||
    /^(export\s+)?(default\s+)?(async\s+)?function\s+\w+/.test(l) ||
    /^(export\s+)?(type|interface|enum)\s+\w+/.test(l) ||
    /^(export\s+)?const\s+[A-Za-z_]\w*\s*[:=(]/.test(l) ||
    /^ {2}(async\s+)?function\s+\w+/.test(l) ||
    /\.(from|rpc)\(\s*["'`]/.test(l) ||
    /router\.(push|replace)\(\s*["'`]/.test(l) ||
    /fetch\(\s*["'`]/.test(l);

  for (const l of lignes) {
    if (aGarder(l)) {
      gardees.push(l.length > 160 ? `${l.slice(0, 160)}...` : l.trimEnd());
    }
  }

  let texte = gardees.join("\n");

  if (texte.length > tailleMax) {
    texte = `${texte.slice(0, tailleMax)}\n[... résumé tronqué]`;
  }

  return texte;
}

/* ===============================================================
   ANALYSE
================================================================ */

function uniques(texte: string, motif: RegExp): string[] {
  const resultat = new Set<string>();

  for (const m of texte.matchAll(motif)) {
    if (m[1]) resultat.add(m[1]);
  }

  return Array.from(resultat).sort();
}

function analyser(source: string) {
  return {
    tables: uniques(source, /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g),
    rpc: uniques(source, /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g),
    api: uniques(source, /fetch\(\s*["'`](\/api\/[^"'`?]+)/g),
    env: uniques(source, /process\.env\.([A-Z0-9_]+)/g),
    composant: /export default (?:async )?function (\w+)/.exec(source)?.[1] ?? null,
  };
}

/* ===============================================================
   FICHIERS
================================================================ */

type Fichier = {
  relatif: string;
  chemin: string;
  taille: number;
  priorite: number;
};

function priorite(rel: string): number {
  if (
    rel === "package.json" ||
    rel === "tsconfig.json" ||
    /^next\.config\./.test(rel) ||
    rel === "middleware.ts" ||
    rel === "proxy.ts"
  ) {
    return 1;
  }

  if (
    rel.startsWith("lib/") ||
    rel.startsWith("components/") ||
    rel.startsWith("app/api/") ||
    rel.startsWith("app/auth/") ||
    rel.startsWith("supabase/") ||
    rel.endsWith(".sql") ||
    rel === "app/layout.tsx" ||
    rel === "app/page.tsx"
  ) {
    return 2;
  }

  if (rel.startsWith("app/")) return 3;
  if (rel.endsWith(".md")) return 5;

  return 4;
}

export function listerFichiers(racine: string): Fichier[] {
  const resultat: Fichier[] = [];

  function parcourir(dossier: string) {
    let entrees: fs.Dirent[];

    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entree of entrees) {
      const chemin = path.join(dossier, entree.name);
      const relatif = path.relative(racine, chemin).replace(/\\/g, "/");

      if (entree.isDirectory()) {
        if (DOSSIERS_EXCLUS.has(entree.name) || entree.name.startsWith(".")) continue;
        parcourir(chemin);
        continue;
      }

      if (!entree.isFile()) continue;
      if (FICHIERS_LOCKS.has(entree.name)) continue;
      if (NOMS_SENSIBLES.test(entree.name)) continue;
      if (relatif === "docs/AI_PROJECT_CONTEXT.md") continue;

      const extension = path.extname(entree.name).toLowerCase();
      const accepte =
        EXTENSIONS.has(extension) ||
        (extension === ".json" && JSON_AUTORISES.has(entree.name));

      if (!accepte) continue;

      try {
        resultat.push({
          relatif,
          chemin,
          taille: fs.statSync(chemin).size,
          priorite: priorite(relatif),
        });
      } catch {
        // fichier inaccessible : ignoré
      }
    }
  }

  parcourir(racine);

  return resultat.sort((a, b) => {
    if (a.priorite !== b.priorite) return a.priorite - b.priorite;
    if (a.taille !== b.taille) return a.taille - b.taille;
    return a.relatif.localeCompare(b.relatif, "fr");
  });
}

/* ===============================================================
   STRUCTURE SUPABASE (format condensé)
================================================================ */

function compacter(valeur: unknown): string {
  return String(valeur ?? "").replace(/\s+/g, " ").trim();
}

function abregerType(type: string): string {
  const t = String(type ?? "");

  return t
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace("character varying", "varchar")
    .replace("boolean", "bool")
    .replace("integer", "int")
    .replace("double precision", "float");
}

export function formaterSupabase(donnees: any, corpsFonctionMax: number): string {
  const lignes: string[] = [];
  const vues: any[] = Array.isArray(donnees?.views) ? donnees.views : [];
  const nomsVues = new Set(vues.map((v) => v.table_name));
  const colonnes = new Map<string, string[]>();

  for (const c of donnees?.columns ?? []) {
    const liste = colonnes.get(c.table_name) ?? [];
    liste.push(`${c.column_name} ${abregerType(c.data_type)}${c.is_nullable === "NO" ? "!" : ""}`);
    colonnes.set(c.table_name, liste);
  }

  lignes.push("TABLES  (colonne type ; ! = obligatoire)");

  for (const t of donnees?.tables ?? []) {
    if (nomsVues.has(t.table_name)) continue;
    lignes.push(`- ${t.table_name}(${(colonnes.get(t.table_name) ?? []).join(", ")})`);
  }

  lignes.push("", "RELATIONS (cle etrangere -> table.colonne)");

  for (const f of donnees?.foreign_keys ?? []) {
    lignes.push(`- ${f.table_name}.${f.column_name} -> ${f.foreign_table}.${f.foreign_column}`);
  }

  lignes.push("", "VUES");

  for (const v of vues) {
    lignes.push(`- ${v.table_name} : ${compacter(v.view_definition)}`);
  }

  lignes.push("", "FONCTIONS SQL");

  for (const f of donnees?.functions ?? []) {
    const definition = String(f.definition ?? "").replace(/\r\n/g, "\n").trim();
    const definer = /SECURITY DEFINER/i.test(definition) ? " [SECURITY DEFINER]" : "";
    const corps = definition.replace(/^CREATE OR REPLACE FUNCTION\s+/i, "");
    const compact = corps.length > corpsFonctionMax ? `${corps.slice(0, corpsFonctionMax)}\n[... tronque]` : corps;

    lignes.push(`- ${f.proname}${definer}`, compact, "");
  }

  lignes.push("POLICIES RLS (table | nom | commande | roles | USING | WITH CHECK)");

  for (const p of donnees?.policies ?? []) {
    const roles = Array.isArray(p.roles) ? p.roles.join(",") : compacter(p.roles);
    lignes.push(
      `- ${p.tablename} | ${p.policyname} | ${p.cmd} | ${roles} | ${compacter(p.qual) || "-"} | ${compacter(p.with_check) || "-"}`
    );
  }

  return lignes.join("\n");
}

/* ===============================================================
   CONSTRUCTION DU CONTEXTE
================================================================ */

const SEP = "################################################################";

function section(titre: string): string[] {
  return ["", SEP, `# ${titre}`, SEP, ""];
}

export function construireContexte(options: {
  racine: string;
  mode: ModeExport;
  supabaseExport: unknown;
  version: { commit: string | null; branche: string | null };
}): { texte: string; stats: StatsExport } {
  const { racine, mode, supabaseExport, version } = options;
  const profil = PROFILS[mode];
  const m: Masquage = { secrets: 0, emails: 0 };

  const fichiers = listerFichiers(racine);
  const avertissement = fichiers.length === 0 ? "AUCUN_FICHIER" : null;
  const lus = new Map<string, string>();
  const analyses = new Map<string, ReturnType<typeof analyser>>();
  const variablesEnv = new Set<string>();

  for (const f of fichiers) {
    if (f.taille > 1_500_000) continue;

    try {
      const contenu = fs.readFileSync(f.chemin, "utf8");
      lus.set(f.relatif, contenu);

      const a = analyser(contenu);
      analyses.set(f.relatif, a);
      a.env.forEach((nom) => variablesEnv.add(nom));
    } catch {
      // illisible : ignoré
    }
  }

  /* ---------- en-tête, instructions ---------- */

  const texte: string[] = [
    SEP,
    "POLYNOV - CONTEXTE IA DU PROJET",
    SEP,
    "",
    `Genere le : ${new Date().toLocaleString("fr-FR")}`,
    `Mode : ${mode === "leger" ? "LEGER (contexte condense)" : "COMPLET (code integral dans la limite du budget)"}`,
    `Commit : ${version.commit ?? "non disponible"} | Branche : ${version.branche ?? "non disponible"}`,
    ...(avertissement
      ? [
          "",
          "!!! ATTENTION : AUCUN FICHIER DE CODE N'A PU ETRE LU !!!",
          "L'export s'est execute sans acces aux sources du projet (cas du site deploye).",
          "Lancez l'export en local (npm run dev) ou configurez outputFileTracingIncludes dans next.config.",
        ]
      : []),
    "",
    "INSTRUCTIONS POUR L'IA",
    "- Respecter l'architecture, les noms de tables/colonnes et les regles metier ci-dessous.",
    "- Ne pas inventer de tables, colonnes, routes ou statuts ; signaler ce qui manque.",
    "- Privilegier des modifications minimales et compatibles.",
    "- Les donnees sensibles ont ete retirees : [SECRET_MASQUE], [EMAIL], [PROJET] sont des",
    "  remplacements volontaires. Ne jamais demander ni reproduire de cle ou de mot de passe.",
    mode === "leger"
      ? "- Les gros fichiers sont resumes (signatures, tables utilisees) et les blocs de styles retires ;\n  demander le fichier complet si un detail manque."
      : "- Certains fichiers peuvent etre omis si le budget de taille est atteint (voir la carte du code).",
  ];

  /* ---------- contexte métier ---------- */

  texte.push(...section("1. CONTEXTE METIER"));

  try {
    const manuel = fs.readFileSync(path.join(racine, "docs", "AI_PROJECT_CONTEXT.md"), "utf8");
    let contenuManuel = masquer(manuel.replace(/\r\n/g, "\n").trim(), m);

    if (contenuManuel.length > profil.contexteManuelMax) {
      contenuManuel = `${contenuManuel.slice(0, profil.contexteManuelMax)}\n[... tronque]`;
    }

    texte.push(contenuManuel);
  } catch {
    texte.push("[docs/AI_PROJECT_CONTEXT.md absent : ajoutez ce fichier pour decrire les regles metier]");
  }

  /* ---------- variables d'environnement ---------- */

  texte.push(...section("2. VARIABLES D'ENVIRONNEMENT (noms uniquement, jamais les valeurs)"));
  texte.push(Array.from(variablesEnv).sort().join("\n") || "(aucune detectee)");

  /* ---------- supabase ---------- */

  texte.push(...section("3. STRUCTURE SUPABASE"));
  texte.push(masquer(formaterSupabase(supabaseExport, profil.corpsFonctionMax), m));

  /* ---------- carte du code ---------- */

  texte.push(...section("4. CARTE DU CODE (fichier - lignes - composant - acces aux donnees)"));

  for (const f of fichiers) {
    const contenu = lus.get(f.relatif);
    const a = analyses.get(f.relatif);
    const nbLignes = contenu ? contenu.split("\n").length : 0;
    const details: string[] = [`${nbLignes} l`, `${Math.max(1, Math.round(f.taille / 1024))} Ko`];

    if (a?.composant) details.push(`composant ${a.composant}`);
    if (a?.tables.length) details.push(`tables: ${a.tables.join(",")}`);
    if (a?.rpc.length) details.push(`rpc: ${a.rpc.join(",")}`);
    if (a?.api.length) details.push(`api: ${a.api.join(",")}`);

    texte.push(`- ${f.relatif} (${details.join(" | ")})`);
  }

  /* ---------- code source ---------- */

  texte.push(...section("5. CODE SOURCE"));

  let octets = Buffer.byteLength(texte.join("\n"), "utf8");
  const reserveFin = 1_200;

  type Prepare = { fichier: Fichier; complet: string; resume: string; estGros: boolean; lignes: number };

  let lignesStylesRetirees = 0;

  const prepares: Prepare[] = [];

  for (const f of fichiers) {
    const contenu = lus.get(f.relatif);
    if (contenu === undefined) continue;

    const compact = compacterSource(masquer(contenu, m), profil.retirerStyles);
    lignesStylesRetirees += compact.retirees;

    prepares.push({
      fichier: f,
      complet: compact.texte,
      resume: resumerFichier(compact.texte, profil.resumeMax),
      estGros: compact.texte.length > profil.tailleMaxFichier,
      lignes: compact.texte.split("\n").length,
    });
  }

  /* Deux passes :
       1. chaque fichier reçoit d'abord son résumé (ou son code complet
          s'il est plus court) : aucun fichier n'est oublié ;
       2. le budget restant sert à passer des fichiers en code complet,
          dans l'ordre de priorité (petits fichiers d'abord). */

  type Choix = "complet" | "resume" | "omis";

  const blocsComplets: string[] = [];
  const blocsResumes: string[] = [];
  const tailles: { complet: number; resume: number }[] = [];

  for (const p of prepares) {
    const enteteComplet = `>>> ${p.fichier.relatif} (${p.lignes} lignes)`;
    const enteteResume = `>>> ${p.fichier.relatif} (RESUME : ${p.lignes} lignes au total)`;
    const fin = `<<< ${p.fichier.relatif}`;

    const blocComplet = `${enteteComplet}\n${p.complet}\n${fin}\n`;
    const blocResume = `${enteteResume}\n${p.resume}\n${fin}\n`;

    blocsComplets.push(blocComplet);
    blocsResumes.push(blocResume);
    tailles.push({
      complet: Buffer.byteLength(blocComplet, "utf8"),
      resume: Buffer.byteLength(blocResume, "utf8"),
    });
  }

  const choix: Choix[] = prepares.map(() => "omis");
  let total = octets + reserveFin;

  prepares.forEach((p, i) => {
    const complet = !p.estGros && tailles[i].complet <= tailles[i].resume;
    const taille = complet ? tailles[i].complet : tailles[i].resume;

    if (total + taille <= profil.budgetTotal) {
      choix[i] = complet ? "complet" : "resume";
      total += taille;
    }
  });

  prepares.forEach((p, i) => {
    if (choix[i] !== "resume" || p.estGros) return;

    const supplement = tailles[i].complet - tailles[i].resume;

    if (total + supplement <= profil.budgetTotal) {
      choix[i] = "complet";
      total += supplement;
    }
  });

  let complets = 0;
  let resumes = 0;
  let omis = 0;

  const blocs: string[] = [];

  choix.forEach((c, i) => {
    if (c === "complet") {
      blocs.push(blocsComplets[i]);
      complets++;
    } else if (c === "resume") {
      blocs.push(blocsResumes[i]);
      resumes++;
    } else {
      omis++;
    }
  });

  texte.push(...blocs);

  texte.push(
    ...section("FIN DU CONTEXTE"),
    `Fichiers candidats : ${fichiers.length} | complets : ${complets} | resumes : ${resumes} | omis (budget) : ${omis}`,
    `Valeurs sensibles masquees : ${m.secrets} | emails masques : ${m.emails}`,
    mode === "leger" ? `Lignes de styles retirees : ${lignesStylesRetirees}` : ""
  );

  const resultat = texte.join("\n");

  return {
    texte: resultat,
    stats: {
      mode,
      octets: Buffer.byteLength(resultat, "utf8"),
      fichiersTrouves: fichiers.length,
      complets,
      resumes,
      omis,
      secretsMasques: m.secrets,
      emailsMasques: m.emails,
      lignesStylesRetirees,
      avertissement,
    },
  };
}
