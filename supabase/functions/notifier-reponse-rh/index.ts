// supabase/functions/notifier-reponse-rh/index.ts
// Informe le collaborateur que sa demande RH est validée ou refusée. Envoi par Microsoft 365 (Microsoft Graph).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type"};
function esc(v:unknown){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
function dateFR(v:string|null){return v?new Date(`${v}T00:00:00`).toLocaleDateString("fr-FR"):"—";}

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

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 try{
  const auth=req.headers.get("Authorization"); if(!auth) throw new Error("Non authentifié.");
  const userClient=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:{user},error:ue}=await userClient.auth.getUser(); if(ue||!user) throw new Error("Session invalide.");
  const {data:validateur}=await admin.from("collaborateurs").select("id,role,prenom,nom,trigramme").eq("auth_user_id",user.id).maybeSingle();
  if(!validateur || String(validateur.role).toUpperCase()!=="ADMIN") throw new Error("Accès administrateur requis.");
  const body=await req.json(); const demandeId=String(body?.demande_id||""); if(!demandeId) throw new Error("Identifiant de demande manquant.");
  const {data:d,error:de}=await admin.from("rh_demandes_admin").select("*").eq("id",demandeId).single(); if(de||!d) throw new Error("Demande introuvable.");
  if(!["VALIDEE","REFUSEE"].includes(String(d.statut))) throw new Error("La demande n'est pas encore validée ou refusée.");
  if(!d.collaborateur_email) throw new Error("Aucune adresse e-mail n'est renseignée pour ce collaborateur.");
  const validee=d.statut==="VALIDEE";
  const sujet=`POLYNOV – Demande RH ${validee?"validée":"refusée"} – ${d.type_demande}`;
  const html=`<h2>Demande RH POLYNOV ${validee?"validée":"refusée"}</h2><p>Bonjour ${esc(d.prenom)},</p><p>Votre demande de <strong>${esc(d.type_demande)}</strong> du ${esc(dateFR(d.date_debut))}${d.date_fin&&d.date_fin!==d.date_debut?` au ${esc(dateFR(d.date_fin))}`:""} a été <strong>${validee?"validée":"refusée"}</strong> par ${esc(validateur.prenom)} ${esc(validateur.nom)}.</p>${d.type_demande==="RE"?`<p><strong>Récupération :</strong> ${esc(d.heures_re)} h</p>`:`<p><strong>Durée :</strong> ${esc(d.duree_jours)} jour(s)</p>`}${d.motif_refus?`<p><strong>Motif du refus :</strong> ${esc(d.motif_refus)}</p>`:""}${d.commentaire?`<p><strong>Votre commentaire :</strong> ${esc(d.commentaire)}</p>`:""}<p>Le détail reste disponible dans votre espace RH POLYNOV.</p>`;
  try{
   await envoyerMail({to:[d.collaborateur_email],subject:sujet,html});
  }catch(err){
   const message=err instanceof Error?err.message:String(err);
   await admin.from("rh_demandes").update({notification_reponse_erreur:message,updated_at:new Date().toISOString()}).eq("id",demandeId);
   throw err;
  }
  await admin.from("rh_demandes").update({notification_reponse_envoyee_le:new Date().toISOString(),notification_reponse_message_id:null,notification_reponse_erreur:null,updated_at:new Date().toISOString()}).eq("id",demandeId);
  return new Response(JSON.stringify({ok:true}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){const message=e instanceof Error?e.message:String(e);console.error("notifier-reponse-rh :",message);return new Response(JSON.stringify({ok:false,error:message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
