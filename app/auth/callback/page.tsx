"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    async function terminerConnexion() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        console.log("AUTH CALLBACK");
        console.log("CODE :", !!code);

        if (!code) {
          console.error("Aucun code OAuth reçu.");
          router.replace("/login");
          return;
        }

        const { error } =
          await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          console.error(
            "Erreur échange code/session :",
            error
          );

          router.replace(
            `/login?erreur=${encodeURIComponent(
              "La connexion Microsoft a échoué."
            )}`
          );

          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        console.log(
          "SESSION MICROSOFT :",
          session?.user?.email
        );

        if (!session) {
          console.error("Session absente après OAuth.");
          router.replace("/login");
          return;
        }

        router.replace("/dashboard");
      } catch (error) {
        console.error(
          "Erreur inattendue callback OAuth :",
          error
        );

        router.replace("/login");
      }
    }

    terminerConnexion();
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Calibri, Arial, sans-serif",
        color: "#555",
      }}
    >
      Connexion Microsoft en cours...
    </div>
  );
}