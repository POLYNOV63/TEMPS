import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { construireContexte, type ModeExport } from "@/lib/exportIA";

export const dynamic = "force-dynamic";

/* ===============================================================
   EXPORT IA

   GET /api/Export-IA?mode=leger     (défaut, environ 200 Ko)
   GET /api/Export-IA?mode=complet   (code intégral, environ 800 Ko)

   Réservé aux administrateurs. Le contenu est construit par
   lib/exportIA.ts : aucune clé, aucun mot de passe ni email
   n'est exporté (voir ce fichier).
================================================================ */

export async function GET(request: Request) {
  try {
    const mode: ModeExport =
      new URL(request.url).searchParams.get("mode") === "complet"
        ? "complet"
        : "leger";

    /* ------------------------- authentification ------------------------- */

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

    /* ----------------------------- droits ADMIN ----------------------------- */

    const { data: collaborateur, error: erreurCollaborateur } = await supabase
      .from("collaborateurs")
      .select("role, actif")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (erreurCollaborateur) {
      console.error("Erreur vérification ADMIN Export IA :", erreurCollaborateur);

      return NextResponse.json(
        { error: "Impossible de vérifier les droits." },
        { status: 500 }
      );
    }

    if (
      !collaborateur ||
      String(collaborateur.role ?? "").trim().toUpperCase() !== "ADMIN" ||
      collaborateur.actif === false
    ) {
      return NextResponse.json(
        { error: "Accès réservé aux administrateurs." },
        { status: 403 }
      );
    }

    /* ------------------------------- Supabase ------------------------------- */

    const { data: supabaseExport, error: erreurSupabaseExport } =
      await supabase.rpc("export_ai_context");

    if (erreurSupabaseExport) {
      console.error("Erreur export Supabase :", erreurSupabaseExport);

      return NextResponse.json(
        {
          error: "Impossible d'exporter le contexte Supabase.",
          detail: erreurSupabaseExport.message,
        },
        { status: 500 }
      );
    }

    /* ------------------------------- contexte ------------------------------- */

    const { texte, stats } = construireContexte({
      racine: process.cwd(),
      mode,
      supabaseExport,
      version: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        branche: process.env.VERCEL_GIT_COMMIT_REF || null,
      },
    });

    return new NextResponse(texte, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="POLYNOV_AI_CONTEXT_${mode}.txt"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Export-Mode": stats.mode,
        "X-Export-Octets": String(stats.octets),
        "X-Export-Complets": String(stats.complets),
        "X-Export-Resumes": String(stats.resumes),
        "X-Export-Omis": String(stats.omis),
        "X-Export-Masques": String(stats.secretsMasques + stats.emailsMasques),
        ...(stats.avertissement
          ? { "X-Export-Avertissement": stats.avertissement }
          : {}),
      },
    });
  } catch (error: any) {
    console.error("Erreur globale Export IA :", error);

    return NextResponse.json(
      {
        error: "Erreur lors de la génération du contexte IA.",
        detail: error?.message || "Erreur inconnue.",
      },
      { status: 500 }
    );
  }
}
