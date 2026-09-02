"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();

  const [prenom, setPrenom] = useState("");
  const [role, setRole] = useState("");
  
useEffect(() => {
  async function chargerCollaborateurConnecte() {
    const {
      data: { user },
    } = await supabase.auth.getUser();


if (!user) {
  router.push("/login");
  return;
}

    

    const {
      data: collaborateur,
      error,
    } = await supabase
      .from("collaborateurs")
      .select("*")
      .eq(
        "auth_user_id",
        user.id
      )
      .single();




if (error || !collaborateur) {

  alert(
    "COLLABORATEUR = " +
    JSON.stringify(collaborateur)
  );

  alert(
    "ERREUR = " +
    JSON.stringify(error)
  );

  return;
}


    setPrenom(
      collaborateur.prenom ?? ""
    );

    setRole(
      collaborateur.role ?? ""
    );
  }

  chargerCollaborateurConnecte();
}, [supabase, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      <header
        style={{
          background: "#c00000",
          color: "white",
          padding: "25px 35px",
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
          }}
        >
          POLYNOV
        </div>

        <div
          style={{
            marginTop: 5,
            opacity: 0.9,
          }}
        >
          Tableau de bord
        </div>
      </header>

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: 30,
        }}
      >
<h1
  style={{
    marginBottom: 10,
    fontSize: 32,
  }}
>
  Bienvenue {prenom}
</h1>

        <div
  style={{
    background: "white",
    borderRadius: 12,
    padding: 24,
    marginBottom: 30,
    borderLeft: "5px solid #c00000",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.08)",
  }}
>
  Bienvenue sur l'application de gestion
  des temps et activités POLYNOV.
</div>

        <p
          style={{
            color: "#666",
          }}
        >
          Bienvenue sur votre espace de gestion du temps.
        </p>
<p
  style={{
    color: "#c00000",
    fontWeight: 700,
  }}
>
  {role}
</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
            marginTop: 30,
          }}
        >
<Carte
  titre="📅 Ma semaine"
            description="Saisir et consulter votre feuille hebdomadaire"
            onClick={() =>
              router.push("/ma-semaine")
            }
          />

<Carte
  titre="🗂️ Mes feuilles"
            description="Historique de vos feuilles de temps"
            onClick={() =>
            router.push("/mes-feuilles")
            }
          />

<Carte
  titre="👥 Collaborateurs"
            description="Gestion des collaborateurs"
            onClick={() =>
              router.push(
                "/admin/collaborateurs"
              )
            }
          />

<Carte
  titre="⏰ Profils horaires"
  description="Gestion des profils et rythmes"
  onClick={() =>
    router.push(
      "/admin/profils-horaires"
    )
  }
/>

{role === "ADMIN" && (
  <Carte
    titre="📄 Feuilles collaborateurs"
    description="Consulter les feuilles de tous les collaborateurs"
    onClick={() =>
      router.push(
        "/admin/feuilles"
      )
    }
  />
)}
``

        </div>
      </div>
    </main>
  );
}



function Carte({
  titre,
  description,
  onClick,
}: {
  titre: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "white",
        borderRadius: 10,
        padding: 24,
        cursor: "pointer",
        boxShadow:
          "0 2px 8px rgba(0,0,0,0.08)",
        border:
          "1px solid #eeeeee",
      }}
    >
      <h2
        style={{
          margin: 0,
          color: "#c00000",
          fontSize: 22,
        }}
      >
        {titre}
      </h2>

      <p
        style={{
          marginTop: 10,
          color: "#666",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
    </div>
  );
}