// supabase/functions/notifier-reponse-rh/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type"};
function esc(v:unknown){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
function dateFR(v:string|null){return v?new Date(`${v}T00:00:00`).toLocaleDateString("fr-FR"):"—";}
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
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("RH_EMAIL_FROM")!,to:[d.collaborateur_email],subject:sujet,html})});
  const result=await r.json();
  if(!r.ok){await admin.from("rh_demandes").update({notification_reponse_erreur:result?.message||"Resend a refusé l'envoi.",updated_at:new Date().toISOString()}).eq("id",demandeId);throw new Error(result?.message||"Resend a refusé l'envoi.");}
  await admin.from("rh_demandes").update({notification_reponse_envoyee_le:new Date().toISOString(),notification_reponse_message_id:result?.id||null,notification_reponse_erreur:null,updated_at:new Date().toISOString()}).eq("id",demandeId);
  return new Response(JSON.stringify({ok:true,id:result?.id||null}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
