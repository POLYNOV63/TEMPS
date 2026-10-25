"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";

/* ===============================================================
   GUIDE DE L'ESPACE POLYNOV (dans l'application)

   Le guide du collaborateur, consultable par tous depuis le tableau de
   bord. La partie « Pour les responsables » (rendez-vous de la semaine
   et du mois, fonctionnement, devis) n'apparaît qu'aux responsables et
   à l'administration.
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

function GuideContenu() {
  const [responsable, setResponsable] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle();
      // partie « responsables » : rôle RESPONSABLE ou ADMIN (et tout rôle qui pilote le BE)
      const role = String((data as { role: string | null } | null)?.role ?? "").trim().toUpperCase();
      setResponsable(role === "RESPONSABLE" || role === "ADMIN" || peut(role, "piloterBE"));
    })().catch(() => setResponsable(false));
  }, []);

  const sommaire: [string, string][] = [
    ["connexion", "Se connecter"],
    ["semaine", "Ma semaine : mes heures"],
    ["route", "Ma feuille de route"],
    ["rh", "Mes demandes RH"],
    ["planning", "Le planning et le bilan d’affaire"],
    ...(responsable ? ([["responsables", "Pour les responsables"]] as [string, string][]) : []),
  ];

  return (
    <main style={page.fond}>
      <EnTetePage section="Guide" />
      <div style={{ ...page.contenu, maxWidth: 900 }}>
        <h1 style={page.titre}>Le guide de l’Espace POLYNOV</h1>
        <p style={page.sousTitre}>
          Espace POLYNOV remplace les feuilles d’heures Excel et les demandes de congés papier. Tout se fait depuis un ordinateur ou un
          téléphone, en quelques minutes par semaine.
        </p>

        <nav aria-label="Sommaire" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}>
          {sommaire.map(([id, titre]) => (
            <a key={id} href={`#${id}`} style={{ ...page.btnSecondaire, minHeight: 36, fontSize: 14, textDecoration: "none" }}>
              {titre}
            </a>
          ))}
        </nav>

        <Section id="connexion" titre="Se connecter">
          <ol>
            <li>Ouvrez l’adresse de l’application reçue par mail et ajoutez-la à vos favoris.</li>
            <li>Connectez-vous avec votre adresse POLYNOV (…@polynov.fr).</li>
            <li>Vous arrivez sur votre tableau de bord : Ma semaine, Ma feuille de route, Mes feuilles et Mes demandes RH.</li>
          </ol>
          <p>Sur téléphone, ajoutez l’application à votre écran d’accueil : elle s’ouvre alors comme une appli.</p>
          <ul>
            <li>
              <strong>iPhone (Safari)</strong> : bouton Partager, puis « Sur l’écran d’accueil ».
            </li>
            <li>
              <strong>Android (Chrome)</strong> : menu ⋮, puis « Ajouter à l’écran d’accueil ».
            </li>
          </ul>
          <p>Un souci de connexion ? Prévenez PLG.</p>
        </Section>

        <Section id="semaine" titre="Ma semaine : mes heures">
          <p>Saisissez vos heures chaque jour, et validez votre semaine le vendredi au plus tard.</p>
          <ol>
            <li>
              Ouvrez <Link href="/ma-semaine" style={{ fontWeight: 700, color: C.rougeFonce }}>Ma semaine</Link> : la semaine en cours s’affiche, jour par jour.
            </li>
            <li>
              Pour chaque jour, ajoutez une ligne par travail fait :
              <ul>
                <li>
                  <strong>CBE</strong> : une commande (n° d’affaire à 4 chiffres, sans les avenants) ;
                </li>
                <li>
                  <strong>DBE</strong> : un devis en cours de rédaction ;
                </li>
                <li>
                  <strong>Divers</strong> : le reste (formation, réunion…), avec une description obligatoire.
                </li>
              </ul>
            </li>
            <li>Choisissez le code d’activité et indiquez les heures.</li>
            <li>
              Le vendredi, cliquez sur <strong>Valider ma semaine</strong> : la feuille part à POLYNOV et n’est plus modifiable.
            </li>
          </ol>
          <p>
            <strong>Le champ « Sous-dossier »</strong> (facultatif) précise la partie de l’affaire : « Lot 2 - châssis », « Plans de détail »…
            Remplissez-le quand une affaire a plusieurs parties : le bilan de l’affaire montre alors les heures par sous-dossier.
          </p>
          <p>
            <strong>Le vendredi à 10 h</strong>, un mail de rappel part automatiquement si votre semaine n’est pas encore validée. Il vous dit où
            vous en êtes : pas commencée, heures manquantes, ou il ne reste qu’à valider.
          </p>
          <p>
            <Link href="/mes-feuilles" style={{ fontWeight: 700, color: C.rougeFonce }}>Mes feuilles</Link> garde toutes vos semaines passées,
            classées par année. Un brouillon se reprend d’un clic ; une feuille validée reste consultable.
          </p>
        </Section>

        <Section id="route" titre="Ma feuille de route : ce qui m’attend">
          <p>
            <Link href="/ma-feuille-de-route" style={{ fontWeight: 700, color: C.rougeFonce }}>Ma feuille de route</Link> montre ce qui est prévu
            pour vous au planning, semaine par semaine.
          </p>
          <ul>
            <li>
              <strong>Une carte par semaine</strong>, la semaine en cours en premier : chaque affaire, les heures prévues jour par jour et son
              délai.
            </li>
            <li>
              <strong>Vos congés</strong> sur leur ligne, en vert ; un « ? » signale un congé demandé mais pas encore validé.
            </li>
            <li>
              <strong>Devis à rédiger</strong>, en haut : les devis qui vous sont confiés, avec leur date de rendu et un compte à rebours. Un
              devis disparaît de la liste dès qu’il est envoyé.
            </li>
            <li>
              <strong>Voir plus loin</strong> : boutons 4 semaines, 2 mois ou 3 mois.
            </li>
          </ul>
          <p>Le planning peut encore bouger. Une semaine vide veut dire que rien n’est encore affecté : votre responsable vous le dira.</p>
        </Section>

        <Section id="rh" titre="Mes demandes RH : congés, RTT, récupération">
          <p>
            Toutes les demandes d’absence passent par <Link href="/RH" style={{ fontWeight: 700, color: C.rougeFonce }}>Mes demandes RH</Link>,
            plus aucune sur papier.
          </p>
          <ol>
            <li>
              Choisissez le type : <strong>CP</strong>, <strong>RTT</strong> ou <strong>récupération</strong> (RE).
            </li>
            <li>
              Indiquez les dates. Pour une demi-journée de CP ou de RTT, comptez <strong>entre 3 h et 4,5 h</strong> : l’application vous
              prévient sinon.
            </li>
            <li>Envoyez : la demande part en validation, et vous êtes prévenu par mail de la réponse.</li>
          </ol>
          <p>
            La page montre aussi vos <strong>soldes</strong> (CP, RTT, compteur de récupération) et l’état de chaque demande : en attente,
            validée ou refusée. Une absence validée apparaît d’elle-même dans Ma semaine et dans votre feuille de route.
          </p>
        </Section>

        <Section id="planning" titre="Le planning et le bilan d’affaire">
          <p>Vous pouvez consulter deux pages communes, en lecture seule :</p>
          <ul>
            <li>
              <strong>Planning des affaires</strong> : qui travaille sur quoi, et quand. ⚑ marque une livraison souhaitée, 📌 le rendu d’un
              devis.
            </li>
            <li>
              <strong>Bilan affaire</strong> : les heures pointées sur une affaire, par activité, par mois et par sous-dossier. Vous y voyez le
              détail de vos propres heures.
            </li>
          </ul>
          <p>
            Une question sur une affaire, une affectation ou un délai ? Voyez votre responsable. Une question sur l’application ou vos droits RH ?
            Voyez PLG.
          </p>
        </Section>

        {responsable && (
          <Section id="responsables" titre="Pour les responsables (FVI, MMO)">
            <p>
              En plus de leur propre espace, les responsables pilotent les affaires au forfait (BE, Scan, Négoce) depuis le{" "}
              <Link href="/pilotage" style={{ fontWeight: 700, color: C.rougeFonce }}>Pilotage BE</Link>.
            </p>
            <Tableau
              entetes={["Je veux…", "Où", "Comment"]}
              lignes={[
                ["Affecter quelqu’un à une affaire", "Planning des affaires", "Double-clic à la date voulue sur la ligne de l’affaire, ou glisser une personne"],
                ["Déplacer ou allonger une affectation", "Planning des affaires", "Glisser la barre, ou étirer ses bords ; un clic puis Suppr pour la supprimer"],
                ["Voir la charge d’une personne", "Planning des affaires", "Menu « 👁 Voir une personne » en haut du planning"],
                ["Confier un devis et sa date de rendu", "Portefeuille", "« ✏️ affecter » sous le rédacteur d’un DBE"],
                ["Changer un responsable ou un délai", "Bilan affaire, panneau Pilotage", "« ✏️ changer » ou « ✏️ modifier le délai », avec un motif"],
                ["Voir la feuille de route d’un collègue", "Pilotage BE, onglet Feuilles de route", "Choisir la personne dans le menu"],
                ["Suivre les feuilles d’heures de l’équipe", "Tableau de bord, Feuilles collaborateurs", "Consulter les semaines de chacun"],
              ]}
            />
            <p>
              Les affaires, devis, statuts et heures chiffrées viennent du Suivi d’affaire BE (Excel) : ils se modifient dans le classeur. Les PE
              et PI se gèrent dans le relevé des prestations, par PLG.
            </p>

            <h3 style={{ margin: "18px 0 6px", fontSize: 18 }}>Mes rendez-vous de responsable</h3>
            <p>
              Les responsables tiennent trois rendez-vous réguliers : les feuilles d’heures chaque semaine, le bilan RH et l’export Excel chaque
              fin de mois.
            </p>
            <Tableau
              entetes={["Quand", "Quoi", "Où"]}
              lignes={[
                ["Vendredi après-midi", "Vérifier les feuilles de la semaine : transmises, à valider, incomplètes, non saisies", "Tableau de bord, vignette Feuilles collaborateurs"],
                ["Vendredi après-midi", "Relancer ceux dont la feuille n’est pas transmise (le mail automatique de 10 h ne suffit pas toujours)", "Feuilles collaborateurs : les noms à relancer y sont listés"],
                ["Lundi matin", "Contrôler les feuilles de la semaine écoulée et les valider : aucune ne doit rester en brouillon", "Feuilles collaborateurs"],
                ["Dernier jour ouvré du mois", "Envoyer aux services du siège le bilan RH mensuel : tickets restaurant, télétravail, heures supplémentaires, compteurs", "Tableau de bord, Bilan RH mensuel"],
                ["Dernier jour ouvré du mois", "Faire l’export Excel des feuilles d’heures du mois et l’envoyer aux services du siège", "Tableau de bord, Export récapitulatif d’heures"],
              ]}
            />
            <p>
              Avant l’envoi du bilan RH, vérifiez que toutes les feuilles du mois sont transmises : une feuille manquante fausse les tickets
              restaurant et les heures supplémentaires. Le bilan RH et l’export Excel partent tous les deux aux services du siège.
            </p>

            <h3 style={{ margin: "18px 0 6px", fontSize: 18 }}>Comment tout fonctionne</h3>
            <p>Tout part du Suivi d’affaire BE (Excel) : l’application le lit, le planning en découle, et chacun voit sa part dans sa feuille de route.</p>
            <ol>
              <li>
                <strong>Le Suivi d’affaire BE fait foi.</strong> Chaque devis ouvert, intention de commande ou commande reçue y est déclaré, avec
                ses heures chiffrées par activité et son délai. À la synchronisation, l’affaire apparaît d’elle-même dans le portefeuille et au
                planning.
              </li>
              <li>
                <strong>Le portefeuille</strong> liste toutes les affaires actives : chiffré, réalisé, reste, délai, alertes. Une affaire livrée
                n’a plus d’alerte.
              </li>
              <li>
                <strong>Le planning</strong> : vous y affectez les personnes aux affaires au forfait (BE, Scan, Négoce). La barre de l’affaire se
                remplit avec le pointé (foncé) puis le planifié (clair) ; la colonne de droite dit ce qui reste à planifier. Un avenant se range
                juste sous sa commande de base.
              </li>
              <li>
                <strong>Les PE et PI</strong> viennent du relevé des prestations, tenu par PLG : on ne les affecte pas au planning.
              </li>
              <li>
                <strong>La feuille de route</strong> de chacun montre ce que le planning lui prévoit, jour par jour, et les devis qu’il doit rendre.
                Vérifiez celle de vos collègues dans l’onglet Feuilles de route : une semaine vide est une place à remplir.
              </li>
              <li>
                <strong>Le pointé</strong> des feuilles d’heures remonte dans le Bilan affaire et dans Charge &amp; pointage : c’est lui qui dit si
                le chiffré tient.
              </li>
            </ol>
            <p>
              Ce qui se modifie dans Excel (affaire, statut, heures chiffrées) ne se modifie pas dans l’application. Ce qui se modifie dans
              l’application : le responsable, le délai (avec un motif) et les affectations.
            </p>

            <h3 style={{ margin: "18px 0 6px", fontSize: 18 }}>Les devis (DBE) pas à pas</h3>
            <p>
              Un devis ouvert dans le Suivi d’affaire arrive seul dans l’application ; vous lui donnez un rédacteur et une date de rendu, et il suit
              son cours jusqu’à l’envoi.
            </p>
            <ol>
              <li>
                <strong>Ouverture</strong> : le devis est saisi « Devis ouvert » dans le Suivi d’affaire BE. Il apparaît dans le portefeuille
                (filtre DBE) et au planning, avec le rédacteur du classeur et une date de rendu par défaut (ouverture + 10 jours ouvrés).
              </li>
              <li>
                <strong>Affectation</strong> : dans le portefeuille, « ✏️ affecter » sous le rédacteur. Choisissez la personne et la date cible de
                rendu, puis Enregistrer. Le changement de date est historisé.
              </li>
              <li>
                <strong>Rédaction</strong> : le devis s’affiche dans la feuille de route du rédacteur, encadré « Devis à rédiger », avec un compte à
                rebours ; au planning, 📌 marque le jour du rendu. Le rédacteur pointe ses heures sur le DBE dans Ma semaine.
              </li>
              <li>
                <strong>Envoi</strong> : le devis passe « Devis envoyé » dans le Suivi d’affaire. À la synchronisation, il quitte la feuille de route
                et le planning, et rejoint les affaires inactives du portefeuille.
              </li>
              <li>
                <strong>Commande</strong> : si le client commande, la CBE arrive à son tour depuis le Suivi d’affaire, avec son n° de devis
                d’origine.
              </li>
            </ol>
            <p>
              Un devis en retard reste signalé en rouge, dans la feuille de route et dans les alertes du portefeuille (« Remise dépassée »), tant
              qu’il n’est pas envoyé.
            </p>
          </Section>
        )}
      </div>
    </main>
  );
}

export default function GuidePage() {
  return (
    <GardeAcces droit={null}>
      <GuideContenu />
    </GardeAcces>
  );
}
