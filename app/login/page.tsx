"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  async function connexionMicrosoft() {
    if (chargement) return;

    setErreur("");
    setChargement(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "email",
      },
    });

    if (error) {
      console.error("Erreur connexion Microsoft 365 :", error);

      setErreur(
        "Impossible de lancer la connexion Microsoft 365 : " +
          error.message
      );

      setChargement(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #f3f3f3 0%, #e9e9e9 100%)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Calibri, Arial, sans-serif",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          background: "#ffffff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 18px 45px rgba(0, 0, 0, 0.14)",
        }}
      >
        {/* HEADER */}

        <div
          style={{
            background: "#c00000",
            color: "#ffffff",
            padding: "36px 30px 32px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 900,
              letterSpacing: 2,
              lineHeight: 1,
            }}
          >
            POLYNOV
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 15,
              opacity: 0.92,
            }}
          >
            Gestion des temps
          </div>
        </div>

        {/* CONTENU */}

        <div
          style={{
            padding: "38px 34px 32px",
          }}
        >
          <div
            style={{
              textAlign: "center",
              marginBottom: 30,
            }}
          >
            <h1
              style={{
                margin: 0,
                color: "#222",
                fontSize: 25,
                fontWeight: 800,
              }}
            >
              Connexion
            </h1>

            <p
              style={{
                margin: "10px 0 0",
                color: "#777",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Connectez-vous avec votre compte
              <br />
              professionnel Microsoft 365.
            </p>
          </div>

          {/* ERREUR */}

          {erreur && (
            <div
              style={{
                marginBottom: 20,
                padding: "11px 13px",
                background: "#fff1f1",
                border: "1px solid #f0b5b5",
                borderRadius: 7,
                color: "#a00000",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {erreur}
            </div>
          )}

          {/* UNIQUE BOUTON DE CONNEXION */}

          <button
            type="button"
            onClick={connexionMicrosoft}
            disabled={chargement}
            style={{
              width: "100%",
              height: 52,
              border: "none",
              borderRadius: 8,
              background: chargement ? "#a00000" : "#c00000",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 700,
              cursor: chargement ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            {!chargement && (
              <span
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 9px)",
                  gridTemplateRows: "repeat(2, 9px)",
                  gap: 2,
                }}
                aria-hidden="true"
              >
                <span style={{ background: "#f25022" }} />
                <span style={{ background: "#7fba00" }} />
                <span style={{ background: "#00a4ef" }} />
                <span style={{ background: "#ffb900" }} />
              </span>
            )}

            {chargement
              ? "Connexion à Microsoft 365..."
              : "Se connecter avec Microsoft 365"}
          </button>

          {/* INFORMATION */}

          <div
            style={{
              marginTop: 22,
              padding: "13px 14px",
              background: "#f7f7f7",
              border: "1px solid #eeeeee",
              borderRadius: 8,
              color: "#777",
              fontSize: 12,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            Utilisez votre compte professionnel POLYNOV.
            <br />
            L'authentification est assurée par Microsoft 365.
          </div>

          {/* FOOTER */}

          <div
            style={{
              marginTop: 28,
              paddingTop: 18,
              borderTop: "1px solid #eeeeee",
              textAlign: "center",
              color: "#999",
              fontSize: 11,
            }}
          >
            POLYNOV — Gestion des temps
          </div>
        </div>
      </div>
    </main>
  );
}