import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  /* ============================================================
     1. Vérification du code OAuth
  ============================================================ */

  if (!code) {
    console.error(
      "AUTH CALLBACK : aucun code OAuth reçu."
    );

    return NextResponse.redirect(
      new URL(
        "/login?erreur=Code%20Microsoft%20absent",
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     2. Client Supabase serveur
        Utilisé pour récupérer la session OAuth
  ============================================================ */

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
          cookiesToSet.forEach(
            ({ name, value, options }) => {
              cookieStore.set(
                name,
                value,
                options
              );
            }
          );
        },
      },
    }
  );

  /* ============================================================
     3. Échange du code Microsoft contre une session Supabase
  ============================================================ */

  const {
    data: sessionData,
    error: erreurSession,
  } =
    await supabase.auth.exchangeCodeForSession(
      code
    );

  if (erreurSession) {
    console.error(
      "AUTH CALLBACK - exchangeCodeForSession :",
      erreurSession
    );

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Connexion Microsoft impossible : " +
            erreurSession.message
        )}`,
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     4. Récupération de l'utilisateur Microsoft
  ============================================================ */

  const user =
    sessionData.user;

  if (!user) {
    console.error(
      "AUTH CALLBACK : utilisateur Supabase introuvable."
    );

    return NextResponse.redirect(
      new URL(
        "/login?erreur=Utilisateur%20introuvable",
        requestUrl.origin
      )
    );
  }

  console.log(
    "AUTH CALLBACK : utilisateur authentifié",
    user.id,
    user.email
  );

  /* ============================================================
     5. Vérification de l'adresse e-mail
  ============================================================ */

  const email =
    user.email?.trim().toLowerCase();

  if (!email) {
    console.error(
      "AUTH CALLBACK : aucune adresse e-mail disponible."
    );

    return NextResponse.redirect(
      new URL(
        "/login?erreur=Adresse%20e-mail%20Microsoft%20introuvable",
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     6. Client ADMIN Supabase
     
        IMPORTANT :
        La clé secrète reste uniquement côté serveur.
        Elle n'est JAMAIS envoyée au navigateur.
  ============================================================ */

  const supabaseAdmin =
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

  /* ============================================================
     7. Recherche du collaborateur par son e-mail
  ============================================================ */

  const {
    data: collaborateur,
    error: erreurRecherche,
  } = await supabaseAdmin
    .from("collaborateurs")
    .select(
      "id, prenom, nom, email, actif, auth_user_id"
    )
    .ilike(
      "email",
      // % et _ sont des jokers de ilike : on les neutralise
      email.replace(/[\\%_]/g, "\\$&")
    )
    .maybeSingle();

  if (erreurRecherche) {
    console.error(
      "AUTH CALLBACK - recherche collaborateur :",
      erreurRecherche
    );

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Impossible de vérifier votre compte collaborateur."
        )}`,
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     8. Aucun collaborateur correspondant
  ============================================================ */

  if (!collaborateur) {
    console.error(
      "AUTH CALLBACK : aucun collaborateur trouvé pour :",
      email
    );

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Votre adresse e-mail n'est pas enregistrée comme collaborateur POLYNOV."
        )}`,
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     8 bis. Collaborateur désactivé : connexion refusée
  ============================================================ */

  if (collaborateur.actif === false) {
    await supabase.auth.signOut();

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Votre compte est désactivé. Contactez l'administrateur."
        )}`,
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     9. Sécurité :
        si le collaborateur est déjà lié à un autre compte,
        on NE REMPLACE PAS le lien automatiquement.
  ============================================================ */

  if (
    collaborateur.auth_user_id &&
    collaborateur.auth_user_id !== user.id
  ) {
    console.error(
      "AUTH CALLBACK : collaborateur déjà associé à un autre compte.",
      {
        collaborateurId:
          collaborateur.id,
        authUserActuel:
          collaborateur.auth_user_id,
        nouvelAuthUser:
          user.id,
      }
    );

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Ce collaborateur est déjà associé à un autre compte Microsoft. Contactez l'administrateur."
        )}`,
        requestUrl.origin
      )
    );
  }

  /* ============================================================
     10. Premier login :
         rattachement automatique
  ============================================================ */

  if (
    !collaborateur.auth_user_id
  ) {
    console.log(
      "AUTH CALLBACK : premier login Microsoft.",
      "Rattachement automatique de",
      email,
      "à",
      user.id
    );

    const {
      error: erreurRattachement,
    } = await supabaseAdmin
      .from("collaborateurs")
      .update({
        auth_user_id: user.id,
      })
      .eq(
        "id",
        collaborateur.id
      );

    if (erreurRattachement) {
      console.error(
        "AUTH CALLBACK - rattachement collaborateur :",
        erreurRattachement
      );

      return NextResponse.redirect(
        new URL(
          `/login?erreur=${encodeURIComponent(
            "Impossible d'associer votre compte Microsoft à votre fiche collaborateur."
          )}`,
          requestUrl.origin
        )
      );
    }

    console.log(
      "AUTH CALLBACK : collaborateur automatiquement associé."
    );
  } else {
    console.log(
      "AUTH CALLBACK : collaborateur déjà associé."
    );
  }

  /* ============================================================
     11. Tout est OK
  ============================================================ */

  console.log(
    "AUTH CALLBACK : connexion Microsoft réussie."
  );

  return NextResponse.redirect(
    new URL(
      "/dashboard",
      requestUrl.origin
    )
  );
}
