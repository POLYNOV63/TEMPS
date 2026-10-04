import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/* ========================================================= */
/* ======================= CONFIGURATION =================== */
/* ========================================================= */

const EXTENSIONS_AUTORISEES = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".sql",
  ".css",
  ".md",
]);

const DOSSIERS_EXCLUS = new Set([
  ".next",
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "build",
]);

/*
 * On ne prend pas les fichiers de configuration sensibles,
 * ni les gros fichiers de dépendances générés.
 */
const FICHIERS_EXCLUS = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/*
 * Limite de sécurité par fichier.
 */
const TAILLE_MAX_FICHIER = 400_000;

/*
 * Limite globale du contexte IA.
 * Au-delà, les fichiers les moins prioritaires sont ignorés.
 */
const TAILLE_MAX_EXPORT = 1_500_000;

/* ========================================================= */
/* ========================== TYPES ======================== */
/* ========================================================= */

type FichierProjet = {
  path: string;
  relative: string;
  taille: number;
  priorite: number;
};

/* ========================================================= */
/* ======================== UTILITAIRES ==================== */
/* ========================================================= */

function estFichierSourcePertinent(relative: string) {
  const normalized = relative.replaceAll("\\", "/");

  /*
   * On ne réinjecte pas le document de contexte manuel dans
   * la partie CODE SOURCE : il est déjà placé au début du fichier.
   */
  if (normalized === "docs/AI_PROJECT_CONTEXT.md") {
    return false;
  }

  if (normalized.includes("POLYNOV_AI_CONTEXT")) {
    return false;
  }

  return true;
}

function prioriteFichier(relative: string) {
  const normalized = relative.replaceAll("\\", "/");

  if (
    normalized === "package.json" ||
    normalized === "tsconfig.json" ||
    normalized.startsWith("supabase/") ||
    normalized.startsWith("lib/") ||
    normalized.startsWith("app/api/")
  ) {
    return 1;
  }

  if (normalized.startsWith("app/")) {
    return 2;
  }

  if (normalized.startsWith("scripts/")) {
    return 3;
  }

  if (normalized.endsWith(".sql")) {
    return 3;
  }

  if (normalized.endsWith(".md")) {
    return 5;
  }

  return 4;
}

function getFiles(
  dir: string,
  result: FichierProjet[] = [],
  root = dir
): FichierProjet[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, {
      withFileTypes: true,
    });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(root, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      if (DOSSIERS_EXCLUS.has(entry.name)) {
        continue;
      }

      if (entry.name.startsWith(".")) {
        continue;
      }

      getFiles(fullPath, result, root);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (
      FICHIERS_EXCLUS.has(entry.name) ||
      entry.name.startsWith(".env")
    ) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!EXTENSIONS_AUTORISEES.has(extension)) {
      continue;
    }

    if (!estFichierSourcePertinent(relative)) {
      continue;
    }

    try {
      const stat = fs.statSync(fullPath);

      result.push({
        path: fullPath,
        relative,
        taille: stat.size,
        priorite: prioriteFichier(relative),
      });
    } catch {
      // Fichier inaccessible : on l'ignore proprement.
    }
  }

  return result;
}

function getVersionProjet() {
  return {
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch:
      process.env.VERCEL_GIT_COMMIT_REF || null,
  };
}

function ajouterLignes(
  lignes: string[],
  ...nouvellesLignes: string[]
) {
  lignes.push(...nouvellesLignes);
}

/* ========================================================= */
/* ============================ GET ======================== */
/* ========================================================= */

export async function GET() {
  try {
    /* ======================================================= */
    /* ================== AUTHENTIFICATION ================== */
    /* ======================================================= */

    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // Certains contextes Next.js sont en lecture seule.
            }
          },
        },
      }
    );

    /* ======================================================= */
    /* ====================== UTILISATEUR ==================== */
    /* ======================================================= */

    const {
      data: { user },
      error: erreurUtilisateur,
    } = await supabase.auth.getUser();

    if (erreurUtilisateur || !user) {
      return NextResponse.json(
        { error: "Authentification requise." },
        { status: 401 }
      );
    }

    /* ======================================================= */
    /* ======================= ADMIN ======================== */
    /* ======================================================= */

    const { data: collaborateur, error: erreurCollaborateur } =
      await supabase
        .from("collaborateurs")
        .select("id, prenom, nom, role, actif, trigramme")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (erreurCollaborateur) {
      console.error(
        "Erreur vérification ADMIN Export IA :",
        erreurCollaborateur
      );

      return NextResponse.json(
        { error: "Impossible de vérifier les droits." },
        { status: 500 }
      );
    }

    if (
      !collaborateur ||
      collaborateur.role !== "ADMIN" ||
      !collaborateur.actif
    ) {
      return NextResponse.json(
        { error: "Accès réservé aux administrateurs." },
        { status: 403 }
      );
    }

    /* ======================================================= */
    /* ======================= FICHIERS ====================== */
    /* ======================================================= */

    const root = process.cwd();
    const tousLesFichiers = getFiles(root);

    /*
     * Les fichiers les plus importants passent en premier.
     * A priorité égale, les plus petits d'abord pour limiter
     * le risque de perdre plusieurs fichiers utiles si la
     * limite globale est atteinte.
     */
    tousLesFichiers.sort((a, b) => {
      if (a.priorite !== b.priorite) {
        return a.priorite - b.priorite;
      }

      if (a.taille !== b.taille) {
        return a.taille - b.taille;
      }

      return a.relative.localeCompare(b.relative, "fr");
    });

    /* ======================================================= */
    /* ======================== SUPABASE ==================== */
    /* ======================================================= */

    const {
      data: supabaseExport,
      error: erreurSupabaseExport,
    } = await supabase.rpc("export_ai_context");

    if (erreurSupabaseExport) {
      console.error(
        "Erreur export Supabase :",
        erreurSupabaseExport
      );

      return NextResponse.json(
        {
          error: "Impossible d'exporter le contexte Supabase.",
          detail: erreurSupabaseExport.message,
        },
        { status: 500 }
      );
    }

    /* ======================================================= */
    /* ========================= VERSION ==================== */
    /* ======================================================= */

    const version = getVersionProjet();

    /* ======================================================= */
    /* ======================= CONTEXTE ===================== */
    /* ======================================================= */

    const lignes: string[] = [];

    ajouterLignes(
      lignes,
      "============================================================",
      "POLYNOV - CONTEXTE IA DU PROJET",
      "============================================================",
      "",
      "DOCUMENT GENERE AUTOMATIQUEMENT",
      "",
      `Date de generation : ${new Date().toLocaleString("fr-FR")}`,
      `Fichiers candidats : ${tousLesFichiers.length}`,
      `Commit Git : ${version.commit || "non disponible"}`,
      `Branche Git : ${version.branch || "non disponible"}`,
      "",
      "============================================================",
      "INSTRUCTIONS POUR L'IA",
      "============================================================",
      "",
      "Ce document est un contexte technique du projet POLYNOV.",
      "",
      "Regles :",
      "- respecter l'architecture existante ;",
      "- respecter les noms de tables et colonnes Supabase ;",
      "- respecter les regles metier decrites dans le contexte ;",
      "- ne pas inventer de tables, colonnes, routes ou statuts ;",
      "- verifier les dependances avant de modifier un fichier ;",
      "- privilegier une modification minimale et compatible ;",
      "- ne jamais demander ni reproduire de secret ou de cle privee ;",
      "- lorsqu'une information manque, la signaler plutot que l'inventer.",
      ""
    );

    /* ======================================================= */
    /* ====================== CONTEXTE MANUEL ================ */
    /* ======================================================= */

    const contexteManuel = path.join(
      root,
      "docs",
      "AI_PROJECT_CONTEXT.md"
    );

    ajouterLignes(
      lignes,
      "============================================================",
      "CONTEXTE METIER POLYNOV",
      "============================================================",
      ""
    );

    if (fs.existsSync(contexteManuel)) {
      try {
        const contenu = fs.readFileSync(
          contexteManuel,
          "utf8"
        );

        ajouterLignes(lignes, contenu, "");
      } catch {
        ajouterLignes(
          lignes,
          "[Impossible de lire docs/AI_PROJECT_CONTEXT.md]",
          ""
        );
      }
    } else {
      ajouterLignes(
        lignes,
        "[docs/AI_PROJECT_CONTEXT.md absent]",
        ""
      );
    }

    /* ======================================================= */
    /* ======================== SUPABASE ===================== */
    /* ======================================================= */

    ajouterLignes(
      lignes,
      "============================================================",
      "STRUCTURE SUPABASE",
      "============================================================",
      "",
      JSON.stringify(supabaseExport, null, 2),
      ""
    );

    /* ======================================================= */
    /* ====================== ARBORESCENCE =================== */
    /* ======================================================= */

    ajouterLignes(
      lignes,
      "============================================================",
      "FICHIERS DU PROJET",
      "============================================================",
      ""
    );

    for (const fichier of tousLesFichiers) {
      ajouterLignes(lignes, fichier.relative);
    }

    ajouterLignes(lignes, "");

    /* ======================================================= */
    /* ======================== CODE ========================= */
    /* ======================================================= */

    ajouterLignes(
      lignes,
      "============================================================",
      "CODE SOURCE",
      "============================================================",
      ""
    );

    let tailleActuelle = Buffer.byteLength(
      lignes.join("\n"),
      "utf8"
    );

    let fichiersInclus = 0;
    let fichiersIgnoreTropGros = 0;
    let fichiersIgnoreLimiteGlobale = 0;

    /*
     * Le fichier de contexte et la structure Supabase sont déjà
     * écrits. On réserve le reste de la taille à l'arborescence
     * et au code source.
     */
    const tailleReserveeFin = 1_500;

    for (const fichier of tousLesFichiers) {
      if (fichier.taille > TAILLE_MAX_FICHIER) {
        fichiersIgnoreTropGros++;
        continue;
      }

      let content: string;

      try {
        content = fs.readFileSync(
          fichier.path,
          "utf8"
        );
      } catch {
        continue;
      }

      const bloc = [
        "",
        "============================================================",
        "FICHIER",
        "============================================================",
        "",
        fichier.relative,
        "",
        "------------------------------------------------------------",
        "CONTENU",
        "------------------------------------------------------------",
        "",
        content,
        "",
      ].join("\n");

      const tailleBloc = Buffer.byteLength(bloc, "utf8");

      if (
        tailleActuelle +
          tailleBloc +
          tailleReserveeFin >
        TAILLE_MAX_EXPORT
      ) {
        fichiersIgnoreLimiteGlobale++;
        continue;
      }

      lignes.push(bloc);
      tailleActuelle += tailleBloc;
      fichiersInclus++;
    }

    /* ======================================================= */
    /* ========================== FIN ======================= */
    /* ======================================================= */

    ajouterLignes(
      lignes,
      "",
      "============================================================",
      "FIN DU CONTEXTE POLYNOV",
      "============================================================",
      "",
      `Fichiers candidats : ${tousLesFichiers.length}`,
      `Fichiers inclus : ${fichiersInclus}`,
      `Fichiers ignores car trop volumineux : ${fichiersIgnoreTropGros}`,
      `Fichiers ignores car limite globale atteinte : ${fichiersIgnoreLimiteGlobale}`,
      `Taille maximale cible : ${TAILLE_MAX_EXPORT} octets`,
      ""
    );

    const output = lignes.join("\n");

    return new NextResponse(output, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="POLYNOV_AI_CONTEXT.txt"',
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error(
      "Erreur globale Export IA :",
      error
    );

    return NextResponse.json(
      {
        error:
          "Erreur lors de la génération du contexte IA.",
        detail:
          error?.message ||
          "Erreur inconnue.",
      },
      { status: 500 }
    );
  }
}
