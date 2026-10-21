// supabase/functions/envoyer-demande-rh/index.ts
// Transmet une demande validée ou refusée au service RH, avec en copie le collaborateur ET les deux
// approbateurs (PLG et AMA), y compris celui qui envoie.
// Envoi par Microsoft 365 (Microsoft Graph).
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

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const auth = req.headers.get("Authorization");
    if(!auth) throw new Error("Non authentifié.");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {global:{headers:{Authorization:auth}}}
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {data:{user},error:ue}=await supabase.auth.getUser();
    if(ue||!user) throw new Error("Session invalide.");

    const {data:me}=await admin.from("collaborateurs").select("id,role,prenom,nom,email,trigramme")
      .eq("auth_user_id",user.id).single();
    if(!me || String(me.role).toUpperCase()!=="ADMIN") throw new Error("Accès administrateur requis.");

    const body=await req.json();
    const id=body.demande_id as string;
    const emailRH=String(body.email_rh||"").trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRH)) throw new Error("Adresse e-mail du service RH invalide : renseignez le champ « Email RH ».");

    const {data:d,error:de}=await admin.from("rh_demandes_admin").select("*").eq("id",id).single();
    if(de||!d) throw new Error("Demande introuvable.");
    if(!["VALIDEE","REFUSEE"].includes(String(d.statut))) throw new Error("La demande doit être validée ou refusée avant l'envoi.");
    if(d.rh_transmise) throw new Error("Cette demande est déjà transmise au RH.");

    // Copie : le collaborateur, PLG et AMA (celui qui envoie compris), sans doublon ni l'adresse RH elle-même
    const {data:approbateurs}=await admin.from("collaborateurs").select("email").in("trigramme",["PLG","AMA"]).eq("actif",true);
    const vus=new Set<string>([emailRH.toLowerCase()]);
    const cc=[d.collaborateur_email, me.email, ...((approbateurs||[]) as {email:string|null}[]).map((a)=>a.email)]
      .map((a)=>String(a||"").trim())
      .filter((a)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
      .filter((a)=>{const k=a.toLowerCase(); if(vus.has(k)) return false; vus.add(k); return true;});

    const objet=`POLYNOV – Demande RH – ${d.prenom} ${d.nom} – ${d.type_demande}`;
    const html=`
      <h2>Demande RH POLYNOV</h2>
      <p><strong>Collaborateur :</strong> ${esc(d.prenom)} ${esc(d.nom)} (${esc(d.trigramme||"")})</p>
      <p><strong>Type :</strong> ${esc(d.type_demande)}</p>
      <p><strong>Date :</strong> ${new Date(d.date_debut).toLocaleDateString("fr-FR")}</p>
      <p><strong>Durée :</strong> ${d.type_demande==="RE" ? `${esc(d.heures_re)} h` : `${esc(d.duree_jours)} jour(s)`}</p>
      ${d.commentaire?`<p><strong>Commentaire :</strong> ${esc(d.commentaire)}</p>`:""}
      <p><strong>Décision :</strong> ${d.statut === "VALIDEE" ? "Validée" : "Refusée"}</p>${d.motif_refus ? `<p><strong>Motif du refus :</strong> ${esc(d.motif_refus)}</p>` : ""}
      <p><strong>Traitée par :</strong> ${esc(me.prenom||"")} ${esc(me.nom||"")}</p>
    `;

    await envoyerMail({to:[emailRH],cc,subject:objet,html});

    await admin.from("rh_demandes").update({
      rh_transmise:true,rh_transmise_le:new Date().toISOString(),rh_transmise_par:me.id,email_rh:emailRH,email_envoye_le:new Date().toISOString(),
      email_message_id:null,updated_at:new Date().toISOString()
    }).eq("id",id);

    return new Response(JSON.stringify({ok:true}),{headers:{...cors,"Content-Type":"application/json"}});
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    console.error("envoyer-demande-rh :",message);
    return new Response(JSON.stringify({ok:false,error:message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  }
});
