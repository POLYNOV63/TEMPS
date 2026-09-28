import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    console.error("AUTH CALLBACK : aucun code reçu.");

    return NextResponse.redirect(
      new URL(
        "/login?erreur=Code%20Microsoft%20absent",
        requestUrl.origin
      )
    );
  }

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
              cookieStore.set(name, value, options);
            }
          );
        },
      },
    }
  );

  const { error } =
    await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error(
      "AUTH CALLBACK - exchangeCodeForSession :",
      error
    );

    return NextResponse.redirect(
      new URL(
        `/login?erreur=${encodeURIComponent(
          "Connexion Microsoft impossible : " +
            error.message
        )}`,
        requestUrl.origin
      )
    );
  }

  console.log(
    "AUTH CALLBACK : connexion Microsoft réussie"
  );

  return NextResponse.redirect(
    new URL("/dashboard", requestUrl.origin)
  );
}