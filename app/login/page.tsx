"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);

  async function connexion() {
    if (chargement) return;

    setErreur("");

    if (!email.trim()) {
      setErreur("Veuillez saisir votre adresse e-mail.");
      return;
    }

    if (!motDePasse) {
      setErreur("Veuillez saisir votre mot de passe.");
      return;
    }

    setChargement(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: motDePasse,
    });

    if (error) {
      setErreur(
        error.message === "Invalid login credentials"
          ? "Adresse e-mail ou mot de passe incorrect."
          : error.message
      );

      setChargement(false);
      return;
    }

    console.log("Connexion OK");

    router.push("/dashboard");
  }

  function gererToucheEntree(
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Enter") {
      connexion();
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
        {/* ========================================================= */}
        {/* HEADER */}
        {/* ========================================================= */}

        <div
          style={{
            background: "#c00000",
            color: "#ffffff",
            padding: "34px 30px 30px",
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
              fontWeight: 500,
              opacity: 0.92,
            }}
          >
            Gestion des temps
          </div>
        </div>

        {/* ========================================================= */}
        {/* FORMULAIRE */}
        {/* ========================================================= */}

        <div
          style={{
            padding: "32px 34px 30px",
          }}
        >
          <div
            style={{
              marginBottom: 28,
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

            <div
              style={{
                marginTop: 7,
                color: "#777",
                fontSize: 14,
              }}
            >
              Connectez-vous à votre espace POLYNOV.
            </div>
          </div>

          {/* ======================================================= */}
          {/* ERREUR */}
          {/* ======================================================= */}

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

          {/* ======================================================= */}
          {/* EMAIL */}
          {/* ======================================================= */}

          <div
            style={{
              marginBottom: 19,
            }}
          >
            <label
              style={{
                display: "block",
                marginBottom: 7,
                color: "#333",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Adresse e-mail
            </label>

            <input
              type="email"
              placeholder="prenom.nom@polynov.fr"
              value={email}
              autoComplete="email"
              onChange={(e) => {
                setEmail(e.target.value);
                if (erreur) setErreur("");
              }}
              onKeyDown={gererToucheEntree}
              disabled={chargement}
              style={{
                width: "100%",
                height: 46,
                boxSizing: "border-box",
                padding: "0 13px",
                border: "1px solid #d2d2d2",
                borderRadius: 7,
                background: chargement ? "#f5f5f5" : "#fff",
                color: "#222",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>

          {/* ======================================================= */}
          {/* MOT DE PASSE */}
          {/* ======================================================= */}

          <div
            style={{
              marginBottom: 23,
            }}
          >
            <label
              style={{
                display: "block",
                marginBottom: 7,
                color: "#333",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Mot de passe
            </label>

            <div
              style={{
                position: "relative",
              }}
            >
              <input
                type={afficherMotDePasse ? "text" : "password"}
                placeholder="••••••••"
                value={motDePasse}
                autoComplete="current-password"
                onChange={(e) => {
                  setMotDePasse(e.target.value);
                  if (erreur) setErreur("");
                }}
                onKeyDown={gererToucheEntree}
                disabled={chargement}
                style={{
                  width: "100%",
                  height: 46,
                  boxSizing: "border-box",
                  padding: "0 75px 0 13px",
                  border: "1px solid #d2d2d2",
                  borderRadius: 7,
                  background: chargement ? "#f5f5f5" : "#fff",
                  color: "#222",
                  fontSize: 14,
                  outline: "none",
                }}
              />

              <button
                type="button"
                onClick={() =>
                  setAfficherMotDePasse(!afficherMotDePasse)
                }
                disabled={chargement}
                style={{
                  position: "absolute",
                  right: 8,
                  top: 7,
                  height: 32,
                  padding: "0 9px",
                  border: "none",
                  background: "transparent",
                  color: "#777",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {afficherMotDePasse ? "Masquer" : "Afficher"}
              </button>
            </div>
          </div>

          {/* ======================================================= */}
          {/* BOUTON */}
          {/* ======================================================= */}

          <button
            type="button"
            onClick={connexion}
            disabled={chargement}
            style={{
              width: "100%",
              height: 47,
              border: "none",
              borderRadius: 7,
              background: chargement ? "#a00000" : "#c00000",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 700,
              cursor: chargement ? "default" : "pointer",
              boxShadow: chargement
                ? "none"
                : "0 5px 12px rgba(192, 0, 0, 0.20)",
            }}
          >
            {chargement ? "Connexion..." : "Se connecter"}
          </button>

          {/* ======================================================= */}
          {/* FOOTER */}
          {/* ======================================================= */}

          <div
            style={{
              marginTop: 25,
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