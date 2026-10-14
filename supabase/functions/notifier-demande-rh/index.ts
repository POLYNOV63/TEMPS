// supabase/functions/notifier-demande-rh/index.ts
// Prévient AMA et PLG qu'une nouvelle demande RH a été déposée. Envoi par Microsoft 365 (Microsoft Graph).
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
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:{user},error:ue}=await supabase.auth.getUser(); if(ue||!user) throw new Error("Session invalide.");
  const body=await req.json(); const demandeId=String(body?.demande_id||""); if(!demandeId) throw new Error("Identifiant de demande manquant.");
  const {data:d,error:de}=await admin.from("rh_demandes_admin").select("*").eq("id",demandeId).single(); if(de||!d) throw new Error("Demande introuvable.");
  const {data:requester}=await admin.from("collaborateurs").select("id,auth_user_id").eq("id",d.collaborateur_id).single();
  if(!requester || requester.auth_user_id!==user.id) throw new Error("Accès refusé.");
  const {data:admins}=await admin.from("collaborateurs").select("email,trigramme,prenom,nom").eq("role","ADMIN").eq("actif",true).in("trigramme",["AMA","PLG"]);
  const to=(admins||[]).map((x:any)=>x.email).filter(Boolean); if(!to.length) throw new Error("Aucun destinataire AMA/PLG configuré.");
  const subject=`POLYNOV – Nouvelle demande RH – ${d.prenom} ${d.nom}`;
  const html=`<h2>Nouvelle demande RH POLYNOV</h2><p><strong>Collaborateur :</strong> ${esc(d.prenom)} ${esc(d.nom)} (${esc(d.trigramme||"")})</p><p><strong>Type :</strong> ${esc(d.type_demande)}</p><p><strong>Période :</strong> ${esc(dateFR(d.date_debut))}${d.date_fin&&d.date_fin!==d.date_debut?` → ${esc(dateFR(d.date_fin))}`:""}</p><p><strong>Durée :</strong> ${d.type_demande==="RE"?`${esc(d.heures_re)} h`:`${esc(d.duree_jours)} jour(s)`}</p>${d.commentaire?`<p><strong>Commentaire :</strong> ${esc(d.commentaire)}</p>`:""}<p>La demande est en attente de traitement dans Validation RH.</p>`;
  await envoyerMail({to,subject,html});
  await admin.from("rh_demandes").update({notification_admin_envoyee_le:new Date().toISOString(),notification_admin_message_id:null,notification_reponse_erreur:null}).eq("id",demandeId);
  return new Response(JSON.stringify({ok:true}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){const message=e instanceof Error?e.message:String(e);console.error("notifier-demande-rh :",message);return new Response(JSON.stringify({ok:false,error:message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
