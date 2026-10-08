// supabase/functions/notifier-demande-rh/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type"};
function esc(v:unknown){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
function dateFR(v:string|null){return v?new Date(`${v}T00:00:00`).toLocaleDateString("fr-FR"):"—";}
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
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("RH_EMAIL_FROM")!,to,subject,html})});
  const result=await r.json(); if(!r.ok) throw new Error(result?.message||"Échec de l'envoi.");
  await admin.from("rh_demandes").update({notification_admin_envoyee_le:new Date().toISOString(),notification_admin_message_id:result?.id||null,notification_reponse_erreur:null}).eq("id",demandeId);
  return new Response(JSON.stringify({ok:true,id:result?.id||null}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
