"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  const [message, setMessage] = useState(
    "Connexion Microsoft en cours..."
  );

  useEffect(() => {
    async function terminerConnexion() {
      try {
        const params = new URLSearchParams(window.location.search);

        const code = params.get("code");
        const error = params.get("error");
        const errorDescription = params.get("error_description");

        console.log("=== AUTH CALLBACK ===");
        console.log("URL :", window.location.href);
        console.log("CODE :", !!code);
        console.log("ERROR :", error);
        console.log("ERROR DESCRIPTION :", errorDescription);

        if (error) {
          console.error(
            "Erreur OAuth Microsoft :",
            error,
            errorDescription
          );

          setMessage(
            `Erreur Microsoft : ${errorDescription || error}`
          );

          return;
        }

        if (!code) {
          console.error("Aucun code OAuth reçu.");

          setMessage(
            "Aucun code de connexion Microsoft n'a été reçu."
          );

          return;
        }

        console.log("Échange du code contre une session...");

        const { data, error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);

        console.log("RESULTAT ECHANGE :", data);
        console.log("ERREUR ECHANGE :", exchangeError);

        if (exchangeError) {
          console.error(
            "ERREUR exchangeCodeForSession :",
            exchangeError
          );

          setMessage(
            `Erreur Supabase : ${exchangeError.message}`
          );

          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        console.log(
          "SESSION :",
          session?.user?.email
        );

        if (!session) {
          console.error(
            "Le code a été échangé mais aucune session n'est disponible."
          );

          setMessage(
            "La connexion a été effectuée mais aucune session n'a été créée."
          );

          return;
        }

        console.log("CONNEXION MICROSOFT OK");

        router.replace("/dashboard");
      } catch (error) {
        console.error(
          "ERREUR INATTENDUE CALLBACK :",
          error
        );

        setMessage(
          `Erreur inattendue : ${
            error instanceof Error
              ? error.message
              : String(error)
          }`
        );
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
        padding: 30,
        textAlign: "center",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            marginBottom: 15,
          }}
        >
          POLYNOV
        </div>

        <div>{message}</div>
      </div>
    </div>
  );
}