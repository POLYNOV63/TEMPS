// supabase/functions/envoyer-note-frais/index.ts
// Transmet une note de frais au service RH, sans validation préalable : le collaborateur l'envoie,
// les administrateurs et lui-même sont en copie. L'e-mail contient TOUT le détail (véhicule, chaque
// déplacement, le déplacement régulier, chaque frais annexe, le total) ; en pièces jointes : la note
// Excel (CT-NFP) remplie et les justificatifs. Une note corrigée peut être retransmise : elle part
// alors en « version 2, 3… » et remplace la précédente.
// Envoi par Microsoft 365 (Microsoft Graph).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type"};
function esc(v:unknown){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
const euros=(n:number)=>(Math.round((Number(n)||0)*100)/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
const nb=(n:unknown)=>(Number(n)||0).toLocaleString("fr-FR",{maximumFractionDigits:2});
const dateFR=(v:string|null)=>v?new Date(`${String(v).slice(0,10)}T00:00:00Z`).toLocaleDateString("fr-FR",{timeZone:"UTC"}):"—";
const moisLong=(v:string)=>new Date(`${v.slice(0,10)}T00:00:00Z`).toLocaleDateString("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"});
// adresses du service RH : secret NF_EMAIL_RH, sinon celles de Validation RH
const EMAIL_RH=(Deno.env.get("NF_EMAIL_RH")||"a.loyer@sibim.fr, e.lavin@sibim.fr").split(/[;,\s]+/).map((a)=>a.trim()).filter(Boolean);
const TAILLE_MAX=3_400_000; // Microsoft 365 : environ 3 Mo de pièces jointes par envoi direct

function base64(octets:Uint8Array){let s="";const p=0x8000;for(let i=0;i<octets.length;i+=p)s+=String.fromCharCode(...octets.subarray(i,i+p));return btoa(s);}
function typeMime(nom:string){
 const e=nom.toLowerCase().split(".").pop()||"";
 return ({pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} as Record<string,string>)[e]||"application/octet-stream";
}

// ---- Envoi via Microsoft 365 (Microsoft Graph) : début
async function jetonGraph():Promise<string>{
 const tenant=Deno.env.get("M365_TENANT_ID"),clientId=Deno.env.get("M365_CLIENT_ID"),secret=Deno.env.get("M365_CLIENT_SECRET");
 if(!tenant||!clientId||!secret) throw new Error("Configuration Microsoft 365 incomplète : secrets M365_TENANT_ID, M365_CLIENT_ID et M365_CLIENT_SECRET à renseigner dans Supabase.");
 const r=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j?.access_token) throw new Error(`Connexion à Microsoft 365 refusée : ${j?.error_description||j?.error||r.status}`);
 return String(j.access_token);
}
type PieceJointe={name:string;contentType:string;contentBytes:string};
async function envoyerMail(m:{to:string[];cc?:string[];subject:string;html:string;pieces:PieceJointe[]}):Promise<void>{
 const expediteur=Deno.env.get("M365_EXPEDITEUR");
 if(!expediteur) throw new Error("Secret M365_EXPEDITEUR manquant : adresse de la boîte d'envoi à renseigner dans Supabase.");
 const adresses=(l?:string[])=>(l||[]).filter(Boolean).map((a)=>({emailAddress:{address:a}}));
 if(!adresses(m.to).length) throw new Error("Aucun destinataire pour l'e-mail.");
 const jeton=await jetonGraph();
 const r=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(expediteur)}/sendMail`,{method:"POST",headers:{Authorization:`Bearer ${jeton}`,"Content-Type":"application/json"},body:JSON.stringify({message:{subject:m.subject,body:{contentType:"HTML",content:m.html},toRecipients:adresses(m.to),ccRecipients:adresses(m.cc),attachments:m.pieces.map((p)=>({"@odata.type":"#microsoft.graph.fileAttachment",...p}))},saveToSentItems:true})});
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
  const {data:me}=await admin.from("collaborateurs").select("id,prenom,nom,email,trigramme,role").eq("auth_user_id",user.id).single();
  if(!me) throw new Error("Collaborateur introuvable.");

  const body=await req.json(); const noteId=String(body?.note_id||""); if(!noteId) throw new Error("Note de frais manquante.");
  const {data:n,error:ne}=await admin.from("nf_notes").select("*").eq("id",noteId).single(); if(ne||!n) throw new Error("Note de frais introuvable.");
  if(n.collaborateur_id!==me.id && String(me.role).toUpperCase()!=="ADMIN") throw new Error("Accès refusé.");
  const {data:c}=await admin.from("collaborateurs").select("prenom,nom,email,trigramme").eq("id",n.collaborateur_id).single();
  const [{data:dep},{data:fr}]=await Promise.all([
   admin.from("nf_deplacements").select("*").eq("note_id",noteId).order("ordre"),
   admin.from("nf_frais").select("*").eq("note_id",noteId).order("ordre"),
  ]);
  const deplacements=(dep||[]) as any[]; const frais=(fr||[]) as any[];

  // ---- calculs (mêmes règles que la note Excel) ----
  const prix=Number(n.prix_km)||0; const kmDom=Number(n.km_domicile)||0;
  const coutDep=(d:any)=>{const km=Number(d.km)||0; return d.depart==="Domicile"?Math.max(0,(km-2*kmDom)*prix):km*prix;};
  const kmPris=(d:any)=>{const km=Number(d.km)||0; return d.depart==="Domicile"?Math.max(0,km-2*kmDom):km;};
  const totalOcc=deplacements.reduce((t,d)=>t+coutDep(d),0);
  const regKm=Number(n.reg_km_jour)||0, regNb=Number(n.reg_nb_trajets)||0;
  const totalReg=regKm>0&&regNb>0?(n.reg_depart==="Domicile"?Math.max(0,(regKm-2*kmDom)*regNb*prix):regKm*regNb*prix):0;
  const totalFrais=frais.reduce((t,f)=>t+(Number(f.montant)||0),0);
  const total=totalOcc+totalReg+totalFrais;

  // ---- pièces jointes : la note Excel, puis les justificatifs ----
  const pieces:PieceJointe[]=[]; let taille=0; const manquants:string[]=[];
  const joindre=async(chemin:string|null,nom:string)=>{
   if(!chemin) return;
   const {data,error}=await admin.storage.from("notes-frais").download(chemin);
   if(error||!data){manquants.push(nom);return;}
   const octets=new Uint8Array(await data.arrayBuffer()); taille+=octets.length;
   pieces.push({name:nom,contentType:typeMime(nom),contentBytes:base64(octets)});
  };
  const mois=moisLong(n.mois); const qui=`${c?.prenom||""} ${c?.nom||""}`.trim();
  const version=(Number(n.version)||0)+1;
  await joindre(n.fichier_path,`Note de frais ${qui} ${mois}${version>1?` v${version}`:""}.xlsx`);
  for(const [i,f] of frais.entries()) if(f.justificatif_path) await joindre(f.justificatif_path,`Justificatif ${i+1} - ${f.justificatif_nom||"piece"}`);
  if(taille>TAILLE_MAX) throw new Error(`Pièces jointes trop lourdes (${(taille/1_000_000).toFixed(1).replace(".",",")} Mo pour 3 Mo au plus) : remplacez les justificatifs les plus lourds (photo plus petite, PDF compressé).`);

  // ---- l'e-mail, avec tout le détail ----
  const th='style="text-align:left;padding:5px 8px;border-bottom:2px solid #ccc;background:#f3f4f6;font-size:13px"';
  const thN='style="text-align:right;padding:5px 8px;border-bottom:2px solid #ccc;background:#f3f4f6;font-size:13px"';
  const td='style="padding:5px 8px;border-bottom:1px solid #e5e5e5"';
  const tdN='style="padding:5px 8px;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap"';
  const occ=deplacements.length?`<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th ${th}>Date</th><th ${th}>Départ</th><th ${th}>Site client</th><th ${thN}>Km A/R</th><th ${thN}>Km indemnisés</th><th ${thN}>Coût</th></tr>${deplacements.map((d)=>`<tr><td ${td}>${esc(dateFR(d.jour))}</td><td ${td}>${esc(d.depart||"—")}</td><td ${td}>${esc(d.site||"—")}</td><td ${tdN}>${nb(d.km)}</td><td ${tdN}>${nb(kmPris(d))}</td><td ${tdN}>${euros(coutDep(d))}</td></tr>`).join("")}<tr><td ${td} colspan="5"><strong>Total des déplacements occasionnels</strong></td><td ${tdN}><strong>${euros(totalOcc)}</strong></td></tr></table>`:"<p>Aucun.</p>";
  const reg=regKm>0&&regNb>0?`<p>Départ : <strong>${esc(n.reg_depart||"—")}</strong> · Site client : <strong>${esc(n.reg_site||"—")}</strong><br>${nb(regKm)} km A/R par jour × ${nb(regNb)} trajet(s) A/R dans le mois${n.reg_depart==="Domicile"?` (moins 2 × ${nb(kmDom)} km domicile → Polynov par trajet)`:""} = <strong>${euros(totalReg)}</strong></p>`:"<p>Aucun.</p>";
  const ann=frais.length?`<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th ${th}>Date</th><th ${th}>Nature</th><th ${th}>Commentaire</th><th ${th}>Justificatif</th><th ${thN}>Montant</th></tr>${frais.map((f,i)=>`<tr><td ${td}>${esc(dateFR(f.jour))}</td><td ${td}>${esc(f.nature||"—")}</td><td ${td}>${esc(f.commentaire||"")}</td><td ${td}>${f.justificatif_path?`pièce jointe n° ${i+1}`:'<span style="color:#b3261e">aucun</span>'}</td><td ${tdN}>${euros(Number(f.montant)||0)}</td></tr>`).join("")}<tr><td ${td} colspan="4"><strong>Total des frais annexes</strong></td><td ${tdN}><strong>${euros(totalFrais)}</strong></td></tr></table>`:"<p>Aucun.</p>";
  const html=`<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#222">
   <h2 style="color:#c00000;margin:0 0 6px">Note de frais – ${esc(mois)}</h2>
   ${version>1?`<p style="background:#fff4e5;border-left:4px solid #e07a00;padding:8px 12px"><strong>Version corrigée n° ${version}</strong> : elle remplace la note transmise le ${esc(new Date(n.transmise_le).toLocaleDateString("fr-FR"))}.</p>`:""}
   <p><strong>Collaborateur :</strong> ${esc(qui)} (${esc(c?.trigramme||"")})<br>
   <strong>Véhicule :</strong> ${esc(n.vehicule||"—")} · <strong>Puissance fiscale :</strong> ${esc(n.puissance||"—")} · <strong>Prix au km :</strong> ${nb(prix)} €<br>
   <strong>Km domicile → Polynov :</strong> ${nb(kmDom)} km</p>
   <h3 style="margin:16px 0 6px">Déplacements occasionnels</h3>${occ}
   <h3 style="margin:16px 0 6px">Déplacement régulier du mois</h3>${reg}
   <h3 style="margin:16px 0 6px">Frais annexes (sur justificatif)</h3>${ann}
   <p style="font-size:18px;background:#f3f7ff;border-left:4px solid #1f4e99;padding:10px 12px;margin-top:18px"><strong>Montant total dû : ${euros(total)}</strong></p>
   <p style="font-size:13px;color:#555">Les kilomètres sont indemnisés au-delà de la distance domicile → Polynov (aller et retour) quand le départ est le domicile.<br>En pièces jointes : la note de frais Excel remplie${frais.some((f)=>f.justificatif_path)?" et les justificatifs":""}.${manquants.length?` <span style="color:#b3261e">Fichier(s) introuvable(s) : ${esc(manquants.join(", "))}.</span>`:""}</p>
   <p style="font-size:13px;color:#555">Transmise par ${esc(me.prenom||"")} ${esc(me.nom||"")} depuis l’application POLYNOV.</p></div>`;

  const {data:admins}=await admin.from("collaborateurs").select("email").eq("role","ADMIN").eq("actif",true);
  const vus=new Set(EMAIL_RH.map((a)=>a.toLowerCase()));
  const cc=[c?.email,...((admins||[]) as {email:string|null}[]).map((a)=>a.email)]
   .map((a)=>String(a||"").trim()).filter((a)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
   .filter((a)=>{const k=a.toLowerCase(); if(vus.has(k)) return false; vus.add(k); return true;});
  const objet=`POLYNOV – Note de frais – ${qui} – ${mois} – ${euros(total)}${version>1?` – version corrigée n° ${version}`:""}`;

  await envoyerMail({to:EMAIL_RH,cc,subject:objet,html,pieces});

  await admin.from("nf_notes").update({statut:"TRANSMISE",version,total:Math.round(total*100)/100,transmise_le:new Date().toISOString(),transmise_a:EMAIL_RH.join(", ")}).eq("id",noteId);
  return new Response(JSON.stringify({ok:true,version,destinataires:EMAIL_RH,copie:cc}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){const message=e instanceof Error?e.message:String(e);console.error("envoyer-note-frais :",message);return new Response(JSON.stringify({ok:false,error:message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
