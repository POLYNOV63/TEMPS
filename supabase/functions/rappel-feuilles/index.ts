// supabase/functions/rappel-feuilles/index.ts
// RAPPEL DU VENDREDI : un e-mail à chaque collaborateur actif (jamais la Direction) dont la feuille
// d'heures de la semaine n'est pas encore validée / transmise. Lancé chaque vendredi par la base
// (pg_cron, SQL 57). Envoi par Microsoft 365 (Microsoft Graph), boîte M365_EXPEDITEUR.
//
// Appel : POST, en-tête « x-rappel-secret » = secret RAPPEL_SECRET.
// Corps facultatif :
//   { "test": "plgaufier@polynov.fr" }  -> n'envoie rien aux collaborateurs : un seul e-mail d'exemple
//                                          à cette adresse, avec la liste de ceux qui seraient relancés
//   { "tous": true }                    -> envoie à tous les actifs, même ceux qui ont déjà validé
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};
function esc(v:unknown){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}

// ---- Envoi via Microsoft 365 (Microsoft Graph) : début
// Secrets Supabase nécessaires : M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, M365_EXPEDITEUR
async function jetonGraph():Promise<string>{
 const tenant=Deno.env.get("M365_TENANT_ID"),clientId=Deno.env.get("M365_CLIENT_ID"),secret=Deno.env.get("M365_CLIENT_SECRET");
 if(!tenant||!clientId||!secret) throw new Error("Configuration Microsoft 365 incomplète : secrets M365_TENANT_ID, M365_CLIENT_ID et M365_CLIENT_SECRET à renseigner dans Supabase.");
 const r=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j?.access_token) throw new Error(`Connexion à Microsoft 365 refusée : ${j?.error_description||j?.error||r.status}`);
 return String(j.access_token);
}
async function envoyerMail(m:{to:string[];cc?:string[];subject:string;html:string}):Promise<void>{
 const expediteur=Deno.env.get("M365_EXPEDITEUR");
 if(!expediteur) throw new Error("Secret M365_EXPEDITEUR manquant : adresse de la boîte d'envoi à renseigner dans Supabase.");
 const adresses=(l?:string[])=>(l||[]).filter(Boolean).map((a)=>({emailAddress:{address:a}}));
 if(!adresses(m.to).length) throw new Error("Aucun destinataire pour l'e-mail.");
 const jeton=await jetonGraph();
 const r=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(expediteur)}/sendMail`,{method:"POST",headers:{Authorization:`Bearer ${jeton}`,"Content-Type":"application/json"},body:JSON.stringify({message:{subject:m.subject,body:{contentType:"HTML",content:m.html},toRecipients:adresses(m.to),ccRecipients:adresses(m.cc)},saveToSentItems:true})});
 if(r.status===202||r.ok) return;
 const j=await r.json().catch(()=>({}));
 throw new Error(`Microsoft 365 a refusé l'envoi : ${j?.error?.message||j?.error?.code||r.status}`);
}
// ---- Envoi via Microsoft 365 (Microsoft Graph) : fin

// ---- dates (heure de Paris)
function aujourdhuiParis(): Date {
  const t = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${t}T00:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const dateFR = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
function semaineIso(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const j = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - j);
  const debut = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - debut.getTime()) / 86400000 + 1) / 7);
}
const h = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

type Collab = { id: string; prenom: string | null; nom: string | null; email: string | null; role: string | null; profil_horaire_id: string | null };
type Feuille = { collaborateur_id: string; statut: string | null; total_heures: number | null; total_theorique: number | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const secret = Deno.env.get("RAPPEL_SECRET");
    if (!secret || req.headers.get("x-rappel-secret") !== secret) return json({ erreur: "Accès refusé." }, 401);

    const options = (await req.json().catch(() => ({}))) as { test?: string; tous?: boolean };
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // semaine en cours (lundi -> vendredi)
    const jour = aujourdhuiParis();
    const lundi = plus(jour, -(((jour.getUTCDay() || 7) - 1)));
    const vendredi = plus(lundi, 4);
    const numero = String(semaineIso(lundi)).padStart(2, "0");

    // collaborateurs actifs, avec un rythme horaire, jamais la Direction
    const { data: collabs, error: ec } = await admin
      .from("collaborateurs")
      .select("id,prenom,nom,email,role,profil_horaire_id")
      .eq("actif", true);
    if (ec) throw ec;
    const equipe = ((collabs ?? []) as Collab[]).filter(
      (c) => String(c.role ?? "").toUpperCase() !== "DIRECTION" && c.email && c.profil_horaire_id
    );

    const { data: feuilles, error: ef } = await admin
      .from("feuilles_heures")
      .select("collaborateur_id,statut,total_heures,total_theorique")
      .eq("semaine_debut", iso(lundi));
    if (ef) throw ef;
    const parCollab = new Map(((feuilles ?? []) as Feuille[]).map((f) => [f.collaborateur_id, f]));

    // absents toute la semaine (congés validés du lundi au vendredi) : pas de relance
    const { data: conges } = await admin
      .from("rh_demandes")
      .select("collaborateur_id,date_debut,date_fin")
      .in("statut", ["VALIDEE", "ENVOYEE_RH"])
      .lte("date_debut", iso(lundi))
      .gte("date_fin", iso(vendredi));
    const absents = new Set(((conges ?? []) as { collaborateur_id: string }[]).map((c) => c.collaborateur_id));

    const appli = (Deno.env.get("APP_URL") || "https://temps-rho.vercel.app").replace(/\/$/, "");

    const aRelancer = equipe
      .filter((c) => !absents.has(c.id))
      .map((c) => {
        const f = parCollab.get(c.id);
        const saisi = Number(f?.total_heures ?? 0);
        const prevu = Number(f?.total_theorique ?? 0);
        const etat = !f
          ? { code: "NON_SAISIE", texte: "votre feuille n'est pas encore commencée" }
          : f.statut === "A_TRAITER"
            ? { code: "TRANSMISE", texte: "votre feuille est déjà validée : merci !" }
            : prevu > 0 && saisi >= prevu - 0.01
              ? { code: "A_VALIDER", texte: `votre feuille est remplie (${h(saisi)} h) : il ne reste qu'à cliquer sur « Valider ma semaine »` }
              : { code: "INCOMPLETE", texte: `il manque encore des heures (${h(saisi)} h saisies${prevu > 0 ? ` sur ${h(prevu)} h` : ""})` };
        return { c, etat };
      })
      .filter((x) => options.tous || x.etat.code !== "TRANSMISE");

    const sujet = `Feuille d'heures S${numero} : à valider avant ce soir`;
    const corps = (prenom: string, etat: string) => `
      <div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#252525;max-width:560px">
        <div style="background:#c00000;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:18px;font-weight:bold">Espace POLYNOV</div>
        <div style="border:1px solid #e3e3e3;border-top:none;padding:18px;border-radius:0 0 8px 8px">
          <p>Bonjour ${esc(prenom)},</p>
          <p>Petit rappel du vendredi : pensez à compléter et <strong>valider votre feuille d'heures</strong> de la semaine
          <strong>S${numero}</strong> (du ${dateFR(lundi)} au ${dateFR(vendredi)}).</p>
          <p style="background:#fff7ea;border-left:4px solid #e9b877;padding:8px 12px">Aujourd'hui, ${esc(etat)}.</p>
          <p style="margin:22px 0"><a href="${appli}/ma-semaine" style="background:#c00000;color:#ffffff;padding:11px 20px;border-radius:7px;text-decoration:none;font-weight:bold">Ouvrir ma semaine</a></p>
          <p style="color:#777777;font-size:12px">Message automatique envoyé chaque vendredi à ceux dont la feuille de la semaine n'est pas encore validée.</p>
        </div>
      </div>`;

    // mode test : un seul e-mail d'exemple, avec la liste de ceux qui seraient relancés
    if (options.test) {
      const liste = aRelancer.map((x) => `<li>${esc(`${x.c.prenom ?? ""} ${x.c.nom ?? ""}`.trim())} — ${esc(x.etat.texte)}</li>`).join("");
      await envoyerMail({
        to: [options.test],
        subject: `[TEST] ${sujet}`,
        html: `${corps("(exemple)", "votre feuille n'est pas encore commencée")}<hr><p style="font-family:Calibri,Arial">Seraient relancés (${aRelancer.length}) :</p><ul style="font-family:Calibri,Arial">${liste}</ul>`,
      });
      return json({ test: true, semaine: `S${numero}`, seraientRelances: aRelancer.length });
    }

    const resultats: { email: string; ok: boolean; erreur?: string }[] = [];
    for (const x of aRelancer) {
      try {
        await envoyerMail({ to: [String(x.c.email)], subject: sujet, html: corps(x.c.prenom ?? "", x.etat.texte) });
        resultats.push({ email: String(x.c.email), ok: true });
      } catch (e) {
        resultats.push({ email: String(x.c.email), ok: false, erreur: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ semaine: `S${numero}`, envoyes: resultats.filter((r) => r.ok).length, echecs: resultats.filter((r) => !r.ok) });
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 500);
  }
});
