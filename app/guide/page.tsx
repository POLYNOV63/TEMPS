"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   GUIDE DE L'ESPACE POLYNOV (GUIDE_V2)

   Réservé aux responsables et à l'administration (droit piloterBE) :
   - ce que voient et font les collaborateurs (pour pouvoir les aider) ;
   - le pilotage du bureau d'études (responsables et administration) ;
   - la partie « Administration » (PE / PI, facturation, finances,
     effectifs, synchronisation) : seulement pour le rôle ADMIN.
   Pour le modifier : changer les textes ci-dessous.
================================================================ */

function Section({ id, titre, children }: { id: string; titre: string; children: ReactNode }) {
  return (
    <section id={id} style={{ ...page.carte, padding: "18px 20px", marginBottom: 16, scrollMarginTop: 20 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 21 }}>{titre}</h2>
      <div style={{ fontSize: 15.5, lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}

const th: CSSProperties = { ...page.th, padding: "8px 10px" };
const td: CSSProperties = { ...page.td, padding: "8px 10px", verticalAlign: "top" };
const lien: CSSProperties = { fontWeight: 700, color: C.rougeFonce };

function Tableau({ entetes, lignes }: { entetes: string[]; lignes: string[][] }) {
  return (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }}>
        <thead>
          <tr>
            {entetes.map((e) => (
              <th key={e} style={th}>
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              {l.map((c, j) => (
                <td key={j} style={{ ...td, fontWeight: j === 0 ? 700 : 400 }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: "18px 0 6px", fontSize: 18 }}>{children}</h3>;
}

function GuideContenu() {
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle();
      setAdmin(String((data as { role: string | null } | null)?.role ?? "").trim().toUpperCase() === "ADMIN");
    })().catch(() => setAdmin(false));
  }, []);

  const sommaire: [string, string][] = [
    ["principe", "Comment tout fonctionne"],
    ["collaborateurs", "Ce que font les collaborateurs"],
    ["pilotage", "Piloter les affaires"],
    ["devis", "Les devis (DBE)"],
    ["rendez-vous", "Mes rendez-vous"],
    ...(admin
      ? ([
          ["pepi", "PE / PI : le relevé"],
          ["facturation", "Facturation et finances"],
          ["effectifs", "Analyse des effectifs"],
          ["synchro", "Synchronisation et agent"],
        ] as [string, string][])
      : []),
  ];

  return (
    <main style={page.fond}>
      <EnTetePage section="Guide" />
      <div style={{ ...page.contenu, maxWidth: 940 }}>
        <h1 style={page.titre}>Le guide de l’Espace POLYNOV</h1>
        <p style={page.sousTitre}>
          Pour les responsables et l’administration : comment fonctionne l’application, ce que font les collaborateurs, et comment piloter le
          bureau d’études.
        </p>

        <nav aria-label="Sommaire" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}>
          {sommaire.map(([id, titre]) => (
            <a key={id} href={`#${id}`} style={{ ...page.btnSecondaire, minHeight: 36, fontSize: 14, textDecoration: "none" }}>
              {titre}
            </a>
          ))}
        </nav>

        <Section id="principe" titre="Comment tout fonctionne">
          <ol>
            <li>
              <strong>Le Suivi d’affaire BE (Excel) fait foi</strong> pour les devis et les commandes : numéros, client, statut, heures chiffrées,
              montants, délais, n° ARC Louxor. Il est synchronisé automatiquement toutes les 5 minutes par l’agent du serveur, dès qu’il est
              enregistré. Ce qui vient du classeur se modifie <strong>dans le classeur</strong>.
            </li>
            <li>
              <strong>L’application gère</strong> le reste : responsables, affectations au planning, dates de rendu des devis, feuilles d’heures,
              demandes RH, relevé des PE / PI.
            </li>
            <li>
              <strong>Le planning</strong> découle des deux : les affaires du classeur, les affectations décidées par les responsables, les PE / PI du
              relevé, les congés validés.
            </li>
            <li>
              <strong>Le pointé</strong> des feuilles d’heures remonte dans le Bilan affaire, le portefeuille et les analyses : c’est lui qui dit si
              le chiffré tient.
            </li>
          </ol>
        </Section>

        <Section id="collaborateurs" titre="Ce que font les collaborateurs">
          <p>Pour pouvoir les aider : voici leur espace (le guide ne leur est pas affiché).</p>
          <Tableau
            entetes={["Page", "Ce qu’ils y font"]}
            lignes={[
              ["Ma semaine", "Saisir leurs heures chaque jour (CBE, DBE ou Divers, code d’activité, sous-dossier facultatif) et valider la semaine le vendredi. Un mail de rappel part le vendredi à 10 h si elle n’est pas validée."],
              ["Ma feuille de route", "Voir ce que le planning leur prévoit, semaine par semaine, leurs congés et les devis à rédiger. Un clic sur un n° d’affaire ouvre sa page."],
              ["Mes feuilles", "Retrouver leurs semaines passées."],
              ["Mes demandes RH", "Demander CP, RTT ou récupération (demi-journée : entre 3 h et 4,5 h), voir leurs soldes et la réponse."],
              ["Planning et Bilan affaire", "Consulter qui fait quoi, et les heures pointées sur une affaire (lecture seule)."],
            ]}
          />
          <p>Sur téléphone, l’application s’ajoute à l’écran d’accueil (Partager, « Sur l’écran d’accueil » ; ou menu ⋮ sur Android).</p>
        </Section>

        <Section id="pilotage" titre="Piloter les affaires">
          <Tableau
            entetes={["Je veux…", "Où", "Comment"]}
            lignes={[
              ["Affecter quelqu’un à une affaire", "Planning des affaires", "Double-clic à la date voulue sur la ligne de l’affaire, ou glisser une personne"],
              ["Déplacer ou allonger une affectation", "Planning des affaires", "Glisser la barre, ou étirer ses bords ; un clic puis Suppr pour la supprimer"],
              ["Revenir à aujourd’hui", "Planning des affaires", "Clic sur le trait rouge de la barre de déplacement ; le jour est entouré en rouge"],
              ["Voir la charge d’une personne", "Planning des affaires", "Menu « 👁 Voir une personne », ou l’onglet Charge par ressource"],
              ["Changer le responsable d’une affaire", "Page de l’affaire, panneau Pilotage", "« ✏️ changer »"],
              ["Changer le délai d’une commande", "Suivi d’affaire BE (Excel)", "Le délai d’une commande vient du classeur : l’application l’affiche en lecture seule"],
              ["Voir la feuille de route d’un collègue", "Pilotage BE, onglet Feuilles de route", "Choisir la personne dans le menu"],
              ["Suivre les feuilles d’heures de l’équipe", "Tableau de bord, Feuilles collaborateurs", "Consulter les semaines de chacun"],
            ]}
          />
          <p>
            <strong>La page d’une affaire</strong> (un clic sur son n°, partout dans l’application) réunit tout : le panneau Pilotage (responsable,
            délai et son historique, affectations), puis le bilan complet (chiffré face au pointé, par activité, par personne, par mois, par
            sous-dossier, négoce). Les collaborateurs y voient le bilan en heures, sans le panneau Pilotage ni les montants.
          </p>
          <p>
            <strong>Une affaire venue du classeur ne se supprime pas</strong> dans l’application : elle reviendrait à la synchronisation suivante.
            Seule une affaire créée à la main peut l’être.
          </p>
        </Section>

        <Section id="devis" titre="Les devis (DBE) pas à pas">
          <ol>
            <li>
              <strong>Ouverture</strong> : le devis est saisi « Devis ouvert » dans le Suivi d’affaire BE. Il apparaît dans le portefeuille (filtre
              DBE) et au planning, avec le rédacteur du classeur et une date de rendu par défaut (ouverture + 10 jours ouvrés).
            </li>
            <li>
              <strong>Affectation</strong> : dans le portefeuille, « ✏️ affecter » sous le rédacteur : la personne et la date de rendu. Au planning,
              le <strong>📌 se glisse</strong> jusqu’au jour voulu pour changer la date de rendu. Chaque changement est historisé.
            </li>
            <li>
              <strong>Rédaction</strong> : le devis s’affiche dans la feuille de route du rédacteur (« Devis à rédiger », avec un compte à rebours).
              Il pointe ses heures sur le DBE dans Ma semaine.
            </li>
            <li>
              <strong>Envoi</strong> : le devis passe « Devis envoyé » dans le classeur. À la synchronisation, il quitte la feuille de route et le
              planning, et rejoint les affaires inactives du portefeuille.
            </li>
            <li>
              <strong>Commande</strong> : si le client commande, la CBE arrive à son tour, avec son n° de devis d’origine.
            </li>
          </ol>
          <p>Un devis en retard reste signalé en rouge (« Remise dépassée ») tant qu’il n’est pas envoyé.</p>
        </Section>

        <Section id="rendez-vous" titre="Mes rendez-vous">
          <Tableau
            entetes={["Quand", "Quoi", "Où"]}
            lignes={[
              ["Vendredi après-midi", "Vérifier les feuilles de la semaine et relancer ceux dont la feuille n’est pas transmise", "Tableau de bord, Feuilles collaborateurs"],
              ["Lundi matin", "Contrôler et valider les feuilles de la semaine écoulée : aucune ne doit rester en brouillon", "Feuilles collaborateurs"],
              ["Dernier jour ouvré du mois", "Envoyer le bilan RH mensuel aux services du siège (tickets restaurant, télétravail, heures sup, compteurs)", "Tableau de bord, Bilan RH mensuel"],
              ["Dernier jour ouvré du mois", "Faire l’export récapitulatif des heures et l’envoyer aux services du siège", "Tableau de bord, Export récapitulatif d’heures"],
            ]}
          />
          <p>Avant l’envoi du bilan RH, vérifiez que toutes les feuilles du mois sont transmises : une feuille manquante fausse les tickets restaurant et les heures supplémentaires.</p>
        </Section>

        {admin && (
          <>
            <Section id="pepi" titre="Administration · PE / PI : le relevé">
              <p>
                Le <Link href="/pilotage/prestations" style={lien}>relevé PE / PI</Link> fait foi depuis le 2 novembre 2026 : plus d’import du Suivi des
                prestations. Ce qu’on y saisit remplit le planning (une seconde après) et la facturation.
              </p>
              <ol>
                <li>
                  <strong>Une nouvelle PE / PI</strong> arrive du Suivi d’affaire BE dans « à staffer » dès l’intention de commande (mention INT. :
                  ses mois sont reportés, ils se factureront à la commande). Son montant et son total d’heures doivent être renseignés dans le classeur.
                </li>
                <li>
                  <strong>La fiche commande</strong> (clic sur le n°, sur ⓘ ou sur le reste) : montant, quantité commandée (montant ÷ taux), taux,
                  consommé, reste en jours et en euros, personnes et leur taux (« taux propre » pour un second profil).
                </li>
                <li>
                  <strong>Staffer</strong> : choisir la personne ; la ligne prend le taux de la commande, modifiable dans ⚙.
                </li>
                <li>
                  <strong>Saisir</strong> : ⤓ remplit le mois, cliquer-glisser puis une valeur et Entrée, Suppr vide. Retirer des heures propose
                  « ↦ Décaler à la fin ». Un coin orange signale un écart avec la feuille d’heures : « feuilles ≡ » aligne la ligne sur le pointé.
                  Les absences sont en bleu (rose pour la maladie).
                </li>
                <li>
                  <strong>Clôturer le mois</strong> une fois la facture faite : l’application liste d’abord ce qui cloche (sans taux, écarts,
                  intentions facturées, commandes dépassées). Les montants sont alors figés.
                </li>
              </ol>
              <p>
                Le bandeau <strong>« Avenant à prévoir »</strong> liste les commandes épuisées ou sous 20 % de reste. Quand un collègue a le relevé
                ouvert, un bandeau le dit, et « ↻ Actualiser » apparaît s’il enregistre quelque chose.
              </p>
            </Section>

            <Section id="facturation" titre="Administration · Facturation et finances">
              <p>
                <Link href="/analyse/facturation" style={lien}>Facturation du mois</Link> : les forfaits livrés dans le mois et les PE / PI du relevé,
                le facturé et le reste à facturer. L’encadré <strong>« Ce qui empêche de facturer »</strong> dit, commande par commande, ce qui bloque
                (pas de commande reçue, date de livraison ou n° ARC Louxor manquant) et quoi faire dans le classeur.
              </p>
              <p>
                <Link href="/analyse/finances" style={lien}>Finances</Link> : l’exercice (novembre → octobre) mois par mois, face au prévisionnel saisi
                ici. Le réalisé se compare à N-1 <strong>à même date</strong> ; la ligne « Cumul réalisé / prévu » donne l’avance ou le retard. Un écart
                inexpliqué avec la comptabilité se corrige par un <strong>ajustement</strong> (imputation « Ajustement », visible dans le détail du mois).
              </p>
            </Section>

            <Section id="effectifs" titre="Administration · Analyse des effectifs">
              <p>
                Dans <Link href="/admin/collaborateurs" style={lien}>Collaborateurs</Link> (bouton Modifier), chacun a une <strong>prédominance</strong>
                (son activité principale) et, s’il y a lieu, des <strong>compétences d’appoint</strong> (le Scan, par exemple). La liste suit « Gestion des
                activités ».
              </p>
              <p>
                <Link href="/analyse/effectifs" style={lien}>Analyse des effectifs</Link> compare la composition de l’équipe (prédominances) aux heures
                réellement pointées dans l’année, et donne les méthodes de vente : BE (forfaits), PE, PI, intergroupe. Visible de l’administration et de
                la Direction.
              </p>
            </Section>

            <Section id="synchro" titre="Administration · Synchronisation et agent">
              <ul>
                <li>
                  <strong>L’agent du serveur</strong> envoie le Suivi d’affaire BE à l’application toutes les 5 minutes, quand il a été enregistré. Le
                  journal de la page <Link href="/admin/synchro-suivi-affaires" style={lien}>Synchronisation</Link> indique « Agent » pour ses passages.
                </li>
                <li>
                  <strong>En secours</strong>, la même page synchronise à la main en deux clics. Le bloc « Contrôle pour la facturation », en bas,
                  liste les lignes à compléter dans le classeur.
                </li>
                <li>
                  <strong>Périmètre</strong> : les devis ouverts depuis le 1er novembre 2023. Un vieux devis resté « Devis ouvert » ne crée pas de DBE.
                </li>
                <li>
                  <strong>Si plus rien ne remonte</strong> : sur le serveur, le journal C:\PolynovAgent\agent-suivi.log donne la raison ; la tâche
                  « POLYNOV - Synchro Suivi d’affaire » doit être « Prête », avec un résultat 0x0.
                </li>
              </ul>
            </Section>
          </>
        )}
      </div>
    </main>
  );
}

export default function GuidePage() {
  return (
    <GardeAcces droit="piloterBE">
      <GuideContenu />
    </GardeAcces>
  );
}
