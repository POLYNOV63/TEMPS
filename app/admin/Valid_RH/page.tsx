'use client';

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Demande={
 id:string;collaborateur_id:string;exercice:number;type_demande:string;date_debut:string;date_fin:string;duree_jours:number;heures_re:number|null;commentaire:string|null;justificatif_nom:string|null;justificatif_url:string|null;statut:string;traitee_par:string|null;traitee_le:string|null;motif_refus:string|null;email_rh:string;email_envoye_le:string|null;created_at:string;validateur_id:string|null;date_validation:string|null;validation_trigramme:string|null;signature_demandeur:string|null;signature_validateur:string|null;trigramme:string|null;prenom:string|null;nom:string|null;collaborateur_email:string|null;validateur_trigramme:string|null;validateur_prenom:string|null;validateur_nom:string|null;
};
const rouge="#c00000";
function dateFR(s:string){return new Date(`${s}T00:00:00`).toLocaleDateString("fr-FR");}
function type(t:string){return ({RE:"Récupération",CP:"CP normal",CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF:"CP exceptionnel avec justificatif",CP_EXCEPTIONNEL_SANS_JUSTIFICATIF:"CP exceptionnel sans justificatif",RTT:"RTT"} as any)[t]||t;}
function badge(s:string){return ({EN_ATTENTE:["#fff3cd","#8a6500","En attente"],VALIDEE:["#e7f6ec","#18713b","Validée"],ENVOYEE_RH:["#e8f0ff","#2455a4","Envoyée RH"],REFUSEE:["#fdecec","#a51d1d","Refusée"],ANNULEE:["#eee","#666","Annulée"]} as any)[s]||["#eee","#555",s];}

function moisFR(numero:number){
 return new Date(2026,numero-1,1).toLocaleDateString("fr-FR",{month:"long"});
}
function groupesArchives(demandes:Demande[]){
 const annees=new Map<number,Map<number,Demande[]>>();
 for(const d of demandes){
  const date=new Date(`${d.date_debut}T00:00:00`);
  const annee=date.getFullYear();
  const mois=date.getMonth()+1;
  if(!annees.has(annee)) annees.set(annee,new Map());
  const parMois=annees.get(annee)!;
  if(!parMois.has(mois)) parMois.set(mois,[]);
  parMois.get(mois)!.push(d);
 }
 return Array.from(annees.entries()).sort((a,b)=>b[0]-a[0]).map(([annee,mois])=>({annee,mois:Array.from(mois.entries()).sort((a,b)=>b[0]-a[0])}));
}

export default function ValidRHPage(){
 const [demandes,setDemandes]=useState<Demande[]>([]);const [filtre,setFiltre]=useState("EN_ATTENTE");const [chargement,setChargement]=useState(true);const [erreur,setErreur]=useState("");const [selection,setSelection]=useState<Demande|null>(null);const [motif,setMotif]=useState("");const [emailRH,setEmailRH]=useState("a.loyer@sibim.fr");const [action,setAction]=useState("");const [me,setMe]=useState<any>(null);
 async function verifierAdmin(){const {data:{user}}=await supabase.auth.getUser();if(!user){window.location.href="/login";return null;}const {data:c,error}=await supabase.from("collaborateurs").select("id,role,trigramme,prenom,nom").eq("auth_user_id",user.id).single();const tri=String(c?.trigramme||"").toUpperCase();if(error||!c||String(c.role).toUpperCase()!=="ADMIN"||!(["PLG","AMA"].includes(tri))){window.location.href="/dashboard";return null;}setMe(c);return c;}
 async function charger(){setChargement(true);setErreur("");try{const admin=await verifierAdmin();if(!admin)return;const {data,error}=await supabase.from("rh_demandes_admin").select("*").order("created_at",{ascending:false});if(error)throw error;setDemandes((data||[]) as Demande[]);}catch(e:any){setErreur(e?.message||"Impossible de charger les demandes RH.");}finally{setChargement(false);}}
 useEffect(()=>{charger();},[]);
 const liste=demandes.filter(d=>filtre==="TOUTES"||d.statut===filtre);const moi=String(me?.trigramme||"").toUpperCase();
 async function valider(d:Demande){if(d.statut!=="EN_ATTENTE")return;if(d.validateur_id){setErreur("Cette demande a déjà été validée par un autre validateur.");return;}setAction("validation");setErreur("");try{const now=new Date().toISOString();const sig=`${me?.prenom||""} ${me?.nom||""}`.trim()+` (${moi}) — ${new Date().toLocaleString("fr-FR")}`;const {error}=await supabase.from("rh_demandes").update({statut:"VALIDEE",validateur_id:me.id,date_validation:now,validation_trigramme:moi,signature_validateur:sig,traitee_par:me.id,traitee_le:now,updated_at:now,email_rh:emailRH||"a.loyer@sibim.fr"}).eq("id",d.id).eq("statut","EN_ATTENTE").is("validateur_id",null);if(error)throw error;setSelection(null);await charger();}catch(e:any){setErreur(e?.message||"Validation impossible.");}finally{setAction("");}}
 async function refuser(d:Demande){if(d.statut!=="EN_ATTENTE")return;if(!motif.trim()){setErreur("Indiquez le motif du refus.");return;}setAction("refus");setErreur("");try{const now=new Date().toISOString();const sig=`${me?.prenom||""} ${me?.nom||""}`.trim()+` (${moi}) — ${new Date().toLocaleString("fr-FR")}`;const {error}=await supabase.from("rh_demandes").update({statut:"REFUSEE",validateur_id:me.id,date_validation:now,validation_trigramme:moi,signature_validateur:sig,traitee_par:me.id,traitee_le:now,motif_refus:motif.trim(),updated_at:now,email_rh:emailRH||"a.loyer@sibim.fr"}).eq("id",d.id).eq("statut","EN_ATTENTE").is("validateur_id",null);if(error)throw error;setMotif("");setSelection(null);await charger();}catch(e:any){setErreur(e?.message||"Refus impossible.");}finally{setAction("");}}
 async function envoyerRH(d:Demande){if(!["VALIDEE","REFUSEE"].includes(d.statut))return;const actionTxt=d.statut==="VALIDEE"?"l’accord":"le refus";if(!window.confirm(`Confirmer l’envoi de ${actionTxt} au service RH (${emailRH}) ?\n\nLa validation elle-même n’a pas envoyé de mail.`))return;setAction("email");setErreur("");try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("Session expirée.");const {error}=await supabase.functions.invoke("envoyer-demande-rh",{body:{demande_id:d.id,email_rh:emailRH||"a.loyer@sibim.fr"}});if(error)throw error;await charger();}catch(e:any){setErreur(e?.message||"Impossible d'envoyer l'email RH.");}finally{setAction("");}}
 return <main style={styles.page}>
  <header style={styles.header}><div><div style={styles.kicker}>POLYNOV · ADMINISTRATION RH</div><h1 style={styles.h1}>Validation RH</h1><p style={styles.sub}>Les demandes sont conservées et classées automatiquement par année puis par mois.</p></div><button style={styles.headerButton} onClick={()=>window.location.href="/dashboard"}>← Tableau de bord</button></header>
  {erreur&&<div style={styles.alert}>{erreur}</div>}
  <section style={styles.toolbar}><label><strong>Filtrer</strong><select value={filtre} onChange={e=>setFiltre(e.target.value)} style={styles.input}><option value="EN_ATTENTE">En attente</option><option value="VALIDEE">Validées</option><option value="ENVOYEE_RH">Envoyées RH</option><option value="REFUSEE">Refusées</option><option value="TOUTES">Toutes</option></select></label><label><strong>Email RH</strong><input style={styles.input} value={emailRH} onChange={e=>setEmailRH(e.target.value)}/></label><button style={styles.refresh} onClick={charger}>↻ Actualiser</button></section>
  {chargement?<div style={styles.card}>Chargement…</div>:
  <div>
   {liste.length===0 ? <div style={styles.card}><div style={styles.empty}>Aucune demande dans ce filtre.</div></div> :
    groupesArchives(liste).map((g)=>
      <details key={g.annee} open={g.annee===new Date().getFullYear()} style={styles.archiveYear}>
       <summary style={styles.archiveYearSummary}>
        <span>📁 <strong>{g.annee}</strong></span>
        <span style={styles.archiveCount}>{g.mois.reduce((s,[,ds])=>s+ds.length,0)} demande(s)</span>
       </summary>
       <div style={styles.archiveYearBody}>
        {g.mois.map(([mois,ds])=>
          <details key={`${g.annee}-${mois}`} open={g.annee===new Date().getFullYear() && mois===new Date().getMonth()+1} style={styles.archiveMonth}>
           <summary style={styles.archiveMonthSummary}>📂 {moisFR(mois)} <span style={styles.archiveCount}>{ds.length}</span></summary>
           <div style={{overflowX:"auto"}}>
            <table style={styles.table}>
             <thead><tr><th>Collaborateur</th><th>Demande</th><th>Date / semaine</th><th>Durée</th><th>Créée le</th><th>Statut</th><th>Validateur</th><th>Actions</th></tr></thead>
             <tbody>{ds.map(d=>{const b=badge(d.statut);return <tr key={d.id}>
              <td><strong>{d.prenom} {d.nom}</strong><br/><small>{d.trigramme}</small></td>
              <td>{type(d.type_demande)}</td>
              <td>{dateFR(d.date_debut)}{d.date_fin!==d.date_debut?<><br/>→ {dateFR(d.date_fin)}</>:null}</td>
              <td>{d.type_demande==="RE"?`${d.heures_re} h`:`${d.duree_jours} j`}</td>
              <td>{new Date(d.created_at).toLocaleDateString("fr-FR")}</td>
              <td><span style={{...styles.badge,background:b[0],color:b[1]}}>{b[2]}</span></td>
              <td>{d.validateur_trigramme||"—"}</td>
              <td><button style={styles.small} onClick={()=>setSelection(d)}>Détails</button></td>
             </tr>})}</tbody>
            </table>
           </div>
          </details>
        )}
       </div>
      </details>
    )}
  </div>}
   {selection&&<div style={styles.overlay}><div style={styles.modal}><div style={styles.modalHead}><div><div style={styles.kicker}>DEMANDE RH</div><h2 style={{margin:"3px 0"}}>{selection.prenom} {selection.nom}</h2><div style={styles.muted}>{selection.trigramme} · {type(selection.type_demande)}</div></div><button style={styles.close} onClick={()=>setSelection(null)}>×</button></div>
   <div style={styles.detailGrid}><Info l="Type" v={type(selection.type_demande)}/><Info l="Date" v={dateFR(selection.date_debut)}/><Info l="Durée" v={selection.type_demande==="RE"?`${selection.heures_re} h`:`${selection.duree_jours} jour(s)`}/><Info l="Email RH" v={emailRH}/></div>
   <div style={styles.signature}><strong>Signature du demandeur</strong><br/>{selection.signature_demandeur||`${selection.prenom||""} ${selection.nom||""}`}</div>
   {selection.validateur_id&&<div style={styles.signature}><strong>Signature du validateur</strong><br/>{selection.signature_validateur||`${selection.validateur_prenom||""} ${selection.validateur_nom||""}`}<br/><small>{selection.date_validation?new Date(selection.date_validation).toLocaleString("fr-FR"):""}</small></div>}
   {selection.commentaire&&<div style={styles.note}><strong>Commentaire</strong><br/>{selection.commentaire}</div>}{selection.justificatif_nom&&<div style={styles.note}><strong>Justificatif</strong><br/>{selection.justificatif_nom}</div>}{selection.motif_refus&&<div style={styles.alert}><strong>Motif du refus</strong><br/>{selection.motif_refus}</div>}
   {selection.statut==="EN_ATTENTE"&&<div><div style={styles.note}><strong>Validation</strong><br/>Aucun validateur n’est encore enregistré. Le premier entre AMA et PLG qui valide clôt la validation.</div><label style={styles.label}>Motif si refus</label><textarea style={{...styles.input,width:"100%",minHeight:70}} value={motif} onChange={e=>setMotif(e.target.value)} placeholder="Obligatoire en cas de refus"/></div>}
   <div style={styles.actions}>{selection.statut==="EN_ATTENTE"&&<><button style={styles.danger} disabled={!!action} onClick={()=>refuser(selection)}>Refuser</button><button style={styles.primary} disabled={!!action} onClick={()=>valider(selection)}>Valider pour moi</button></>}{["VALIDEE","REFUSEE"].includes(selection.statut)&&<button style={styles.primary} disabled={!!action} onClick={()=>envoyerRH(selection)}>{action==="email"?"Envoi…":selection.statut==="VALIDEE"?"Envoyer l’accord à la RH":"Envoyer le refus à la RH"}</button>}<button style={styles.secondary} onClick={()=>setSelection(null)}>Fermer</button></div>
  </div></div>}
 </main>;
}
function Info({l,v}:{l:string,v:string}){return <div style={styles.info}><span>{l}</span><strong>{v}</strong></div>}
const styles:any={archiveYear:{background:"#fff",border:"1px solid #e2e5e9",borderRadius:12,marginBottom:12,overflow:"hidden"},archiveYearSummary:{cursor:"pointer",padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:16},archiveYearBody:{padding:"0 12px 12px",background:"#fafbfc"},archiveMonth:{background:"#fff",border:"1px solid #e7e9ec",borderRadius:9,marginTop:10,overflow:"hidden"},archiveMonthSummary:{cursor:"pointer",padding:"11px 13px",display:"flex",justifyContent:"space-between",alignItems:"center",fontWeight:700},archiveCount:{fontSize:12,color:"#777",fontWeight:700},page:{minHeight:"100vh",background:"#f5f6f8",fontFamily:"Calibri,Arial,sans-serif",padding:"32px 5vw",color:"#252525"},header:{background:rouge,color:"#fff",borderRadius:14,padding:"25px 30px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",gap:20},headerButton:{border:"1px solid rgba(255,255,255,.5)",background:"transparent",color:"#fff",borderRadius:8,padding:"10px 14px",fontWeight:700,cursor:"pointer"},kicker:{fontSize:12,fontWeight:700,letterSpacing:1.2,opacity:.85},h1:{margin:"4px 0",fontSize:32},sub:{margin:0,opacity:.9},toolbar:{background:"#fff",border:"1px solid #e2e5e9",borderRadius:12,padding:14,display:"flex",gap:14,alignItems:"end",marginBottom:16,flexWrap:"wrap"},input:{display:"block",marginTop:5,border:"1px solid #d7dadd",borderRadius:8,padding:"9px 10px",fontFamily:"inherit",fontSize:14},refresh:{border:0,borderRadius:8,padding:"10px 14px",background:"#333",color:"#fff",fontWeight:700,cursor:"pointer"},card:{background:"#fff",border:"1px solid #e2e5e9",borderRadius:14,padding:18},table:{width:"100%",borderCollapse:"collapse",fontSize:14,textAlign:"center"},small:{border:"1px solid #ddd",background:"#fff",borderRadius:7,padding:"7px 10px",cursor:"pointer"},badge:{padding:"5px 9px",borderRadius:20,fontWeight:700,fontSize:12},empty:{padding:30,textAlign:"center",color:"#777"},alert:{background:"#fdecec",color:"#a51d1d",padding:12,borderRadius:10,marginBottom:16},overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:20},modal:{background:"#fff",borderRadius:16,width:"min(760px,100%)",padding:24,maxHeight:"90vh",overflow:"auto"},modalHead:{display:"flex",justifyContent:"space-between",alignItems:"start",borderBottom:"1px solid #eee",paddingBottom:15,marginBottom:18},close:{border:0,background:"#eee",borderRadius:8,fontSize:24,width:38,height:38,cursor:"pointer"},muted:{color:"#6d737a"},detailGrid:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10},info:{background:"#f7f7f7",padding:12,borderRadius:9,display:"flex",flexDirection:"column",gap:4,fontSize:13},signature:{background:"#f3f7ff",border:"1px solid #dbe5f5",borderRadius:9,padding:13,marginTop:12,lineHeight:1.5},note:{background:"#f8f8f8",borderRadius:9,padding:13,marginTop:14,lineHeight:1.5},label:{display:"block",fontWeight:700,fontSize:13,marginTop:16,marginBottom:6},actions:{display:"flex",gap:10,justifyContent:"flex-end",marginTop:22,flexWrap:"wrap"},primary:{border:0,borderRadius:8,padding:"11px 17px",background:rouge,color:"#fff",fontWeight:800,cursor:"pointer"},danger:{border:0,borderRadius:8,padding:"11px 17px",background:"#8d1d1d",color:"#fff",fontWeight:800,cursor:"pointer"},delete:{border:"1px solid #e1bcbc",borderRadius:8,padding:"11px 17px",background:"#fff",color:rouge,fontWeight:800,cursor:"pointer"},secondary:{border:"1px solid #ddd",borderRadius:8,padding:"11px 17px",background:"#fff",fontWeight:700,cursor:"pointer"}};
