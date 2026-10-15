#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Validation RH : annulations

   1. Le filtre « Statut » propose « Annulées ».
   2. La fenêtre « Détails » d'une demande annulée indique quand, le statut avant
      annulation, le motif et les semaines de feuilles déjà validées à corriger.
   3. Un administrateur peut annuler une demande (en attente, validée ou refusée) depuis ses
      détails (bouton « Annuler la demande », motif facultatif) : même effet que
      l'annulation par le collaborateur, AMA, PLG, le service RH (si la demande lui
      avait été transmise) et le collaborateur sont prévenus par e-mail.

   Version 2 : l'annulation vaut pour TOUS les statuts, y compris une demande refusée (archivée
   sans e-mail). Met à jour la version 1.

   Prérequis : script SQL 18 (version à jour) exécuté et fonction notifier-annulation-rh déployée.

   Utilisation, depuis la racine du projet :
       node scripts/patch-valid-rh-annulation.mjs

   Tout ou rien. Sauvegarde : page.tsx.bak-valid-rh-annulation. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const cible = path.resolve(process.argv[2] ?? "app/admin/Valid_RH/page.tsx");

if (!fs.existsSync(cible)) {
  console.error(`Fichier introuvable : ${cible}\nLancez ce script depuis la racine du projet.`);
  process.exit(1);
}

const original = fs.readFileSync(cible, "utf8");
const crlf = original.includes("\r\n");
let source = original.replace(/\r\n/g, "\n");

if (source.includes("annulation-tous-statuts")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

// Version 1 déjà installée : on met à jour sur place (l'annulation vaut alors pour tous les statuts).
const versionUn = source.includes("rh_annuler_demande");

const echecs = [];

function remplacer(nom, ancien, nouveau) {
  const n = source.split(ancien).length - 1;

  if (n !== 1) {
    echecs.push(`${nom} : ${n === 0 ? "introuvable" : `présent ${n} fois`}`);
    return;
  }

  source = source.replace(ancien, nouveau);
}

const MISES_A_JOUR_V2 = [
  ["if(![\"EN_ATTENTE\",\"VALIDEE\",\"ENVOYEE_RH\"].includes(d.statut))return;", "if(![\"EN_ATTENTE\",\"VALIDEE\",\"ENVOYEE_RH\",\"REFUSEE\"].includes(d.statut))return; const dejaRefusee=d.statut===\"REFUSEE\"; /*annulation-tous-statuts*/"],
  ["\\n\\nAMA, PLG${d.rh_transmise?\", le service RH\":\"\"} et le collaborateur seront prévenus par e-mail.\\n\\nMotif", "\\n\\n${d.statut===\"REFUSEE\"?\"Elle était déjà refusée : personne ne sera prévenu par e-mail.\":`AMA, PLG${d.rh_transmise?\", le service RH\":\"\"} et le collaborateur seront prévenus par e-mail.`}\\n\\nMotif"],
  ["const notification=await supabase.functions.invoke(\"notifier-annulation-rh\",{body:{demande_id:d.id}});", "const notification:any=dejaRefusee?{error:null}:await supabase.functions.invoke(\"notifier-annulation-rh\",{body:{demande_id:d.id}});"],
  ["{[\"EN_ATTENTE\",\"VALIDEE\",\"ENVOYEE_RH\"].includes(selection.statut)&&<button style={styles.delete}", "{[\"EN_ATTENTE\",\"VALIDEE\",\"ENVOYEE_RH\",\"REFUSEE\"].includes(selection.statut)&&<button style={styles.delete}"],
  ["infosAnnulation.statut_avant_annulation===\"EN_ATTENTE\"?\"en attente\":\"validée\"", "infosAnnulation.statut_avant_annulation===\"EN_ATTENTE\"?\"en attente\":infosAnnulation.statut_avant_annulation===\"REFUSEE\"?\"refusée\":\"validée\""],
];

if (!versionUn) {
/* 1) filtre « Annulées » */
remplacer(
  "filtre Statut",
  '<option value="REFUSEE">Refusées</option>',
  '<option value="REFUSEE">Refusées</option><option value="ANNULEE">Annulées</option>'
);

/* 2) informations d'annulation de la demande ouverte (lues dans rh_demandes) */
remplacer(
  "état « me »",
  "const [me,setMe]=useState<any>(null);",
  "const [me,setMe]=useState<any>(null);const [infosAnnulation,setInfosAnnulation]=useState<any>(null);"
);

remplacer(
  "chargement initial",
  "useEffect(()=>{charger();},[]);",
  `useEffect(()=>{charger();},[]);
 useEffect(()=>{
   setInfosAnnulation(null);
   if(selection?.statut!=="ANNULEE")return;
   let actif=true;
   (async()=>{
     const {data}=await supabase.from("rh_demandes").select("annulee_le,motif_annulation,statut_avant_annulation,annulation_feuilles_a_corriger").eq("id",selection.id).maybeSingle();
     if(actif)setInfosAnnulation(data);
   })();
   return()=>{actif=false;};
 },[selection?.id,selection?.statut]);`
);

/* 3) annulation par un administrateur */
remplacer(
  "fonction supprimer",
  "async function supprimer(d:Demande){",
  `async function annuler(d:Demande){
   if(!["EN_ATTENTE","VALIDEE","ENVOYEE_RH"].includes(d.statut))return;
   const motifAnnulation=window.prompt(\`Annuler la demande de \${d.prenom||""} \${d.nom||""} (\${type(d.type_demande)}, \${dateFR(d.date_debut)}) ?\\n\\nAMA, PLG\${d.rh_transmise?", le service RH":""} et le collaborateur seront prévenus par e-mail.\\n\\nMotif de l’annulation (facultatif) :\`,"");
   if(motifAnnulation===null)return;
   setAction("annulation");setErreur("");
   try{
     const {data,error}=await supabase.rpc("rh_annuler_demande",{p_demande_id:d.id,p_motif:motifAnnulation.trim()||null});
     if(error)throw error;
     const resultat:any=Array.isArray(data)?data[0]:data;
     const notification=await supabase.functions.invoke("notifier-annulation-rh",{body:{demande_id:d.id}});
     setSelection(null);
     await charger();
     if(notification.error){setErreur("Demande annulée, mais l’e-mail d’information n’a pas pu être envoyé : prévenez les personnes concernées.");}
     else if(resultat?.feuilles_a_corriger){setErreur(\`Demande annulée. Attention : les feuilles déjà validées des semaines du \${resultat.feuilles_a_corriger} contiennent encore cette absence : à corriger.\`);}
   }catch(e:any){setErreur(e?.message||"Annulation impossible.");}
   finally{setAction("");}
 }
 async function supprimer(d:Demande){`
);

/* 4) détails d'une demande annulée */
remplacer(
  "motif de refus (détails)",
  "{selection.motif_refus&&<div style={styles.alert}><strong>Motif du refus</strong><br/>{selection.motif_refus}</div>}",
  `{selection.motif_refus&&<div style={styles.alert}><strong>Motif du refus</strong><br/>{selection.motif_refus}</div>}{selection.statut==="ANNULEE"&&<div style={styles.note}><strong>Demande annulée</strong><br/>{infosAnnulation?.annulee_le?\`Le \${new Date(infosAnnulation.annulee_le).toLocaleString("fr-FR")}\`:""}{infosAnnulation?.statut_avant_annulation?\` · statut avant annulation : \${infosAnnulation.statut_avant_annulation==="EN_ATTENTE"?"en attente":"validée"}\`:""}{infosAnnulation?.motif_annulation?<><br/>Motif : {infosAnnulation.motif_annulation}</>:null}{infosAnnulation?.annulation_feuilles_a_corriger?<><br/><strong>À corriger :</strong> feuilles déjà validées des semaines du {infosAnnulation.annulation_feuilles_a_corriger}</>:null}</div>}`
);

/* 5) bouton d'annulation dans les détails */
remplacer(
  "bouton Fermer",
  "<button style={styles.secondary} onClick={()=>setSelection(null)}>Fermer</button>",
  `{["EN_ATTENTE","VALIDEE","ENVOYEE_RH"].includes(selection.statut)&&<button style={styles.delete} disabled={!!action} onClick={()=>annuler(selection)}>{action==="annulation"?"Annulation…":"Annuler la demande"}</button>}<button style={styles.secondary} onClick={()=>setSelection(null)}>Fermer</button>`
);
}

/* Version 2 : l'annulation vaut pour tous les statuts (en attente, validée, refusée) */
for (const [ancien, nouveau] of MISES_A_JOUR_V2) remplacer("mise à jour version 2", ancien, nouveau);

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces du fichier n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLe fichier a probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

if (!versionUn) fs.copyFileSync(cible, `${cible}.bak-valid-rh-annulation`);
fs.writeFileSync(cible, crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");

console.log("Validation RH : filtre « Annulées », détails d'annulation et bouton « Annuler la demande » installés.");
console.log(versionUn ? "Mise à jour de la version 1 faite. Lancez « npx tsc --noEmit » puis « npm run dev »." : "Sauvegarde : page.tsx.bak-valid-rh-annulation. Lancez « npx tsc --noEmit » puis « npm run dev ».");
