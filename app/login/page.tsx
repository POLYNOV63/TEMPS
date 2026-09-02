"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

const router = useRouter();


async function connexion() {
  const { error } =
    await supabase.auth.signInWithPassword({
      email,
      password: motDePasse,
    });

  if (error) {
    alert(error.message);
    return;
  }
console.log("Connexion OK");

window.location.href = "/dashboard";
}

 return (
  <main
    style={{
      minHeight: "100vh",
      background: "#f5f5f5",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "Calibri, Arial, sans-serif",
      padding: 20,
    }}
  >
    <div
      style={{
        width: 420,
        background: "white",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
      }}
    >
      {/* Header */}

      <div
        style={{
          background: "#c00000",
          color: "white",
          padding: "30px 25px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          POLYNOV
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 16,
            opacity: 0.95,
          }}
        >
          Gestion des temps
        </div>
      </div>

      {/* Formulaire */}

      <div
        style={{
          padding: 30,
        }}
      >
        <h1
          style={{
            marginTop: 0,
            marginBottom: 25,
            fontSize: 24,
            color: "#222",
          }}
        >
          Connexion
        </h1>

        <div
          style={{
            marginBottom: 15,
          }}
        >
          <label
            style={{
              display: "block",
              marginBottom: 6,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Adresse e-mail
          </label>

          <input
            type="email"
            placeholder="prenom.nom@polynov.fr"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "11px 12px",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>

        <div
          style={{
            marginBottom: 20,
          }}
        >
          <label
            style={{
              display: "block",
              marginBottom: 6,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Mot de passe
          </label>

          <input
            type="password"
            placeholder="••••••••"
            value={motDePasse}
            onChange={(e) =>
              setMotDePasse(
                e.target.value
              )
            }
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "11px 12px",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>

<button
  onClick={connexion}
  
          style={{
            width: "100%",
            padding: "12px",
            background: "#c00000",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Se connecter
        </button>

        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            color: "#777",
            fontSize: 12,
          }}
        >
          Version de développement
        </div>
      </div>
    </div>
  </main>
  );
}