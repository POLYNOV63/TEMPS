// supabase/functions/envoyer-demande-rh/index.ts
// Secrets Supabase nécessaires : RESEND_API_KEY, RH_EMAIL_FROM
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};

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
    const emailRH=String(body.email_rh||"a.loyer@sibim.fr");

    const {data:d,error:de}=await admin.from("rh_demandes_admin").select("*").eq("id",id).single();
    if(de||!d) throw new Error("Demande introuvable.");
    if(!["VALIDEE","REFUSEE"].includes(String(d.statut))) throw new Error("La demande doit être validée ou refusée avant l'envoi.");
    if(d.rh_transmise) throw new Error("Cette demande est déjà transmise au RH.");

    const approbateurAutre = me.trigramme==="PLG" ? "AMA" : "PLG";
    const {data:autre}=await admin.from("collaborateurs").select("email").eq("trigramme",approbateurAutre).eq("actif",true).maybeSingle();
    const cc=[d.collaborateur_email, autre?.email].filter(Boolean);

    const objet=`POLYNOV – Demande RH – ${d.prenom} ${d.nom} – ${d.type_demande}`;
    const html=`
      <h2>Demande RH POLYNOV</h2>
      <p><strong>Collaborateur :</strong> ${d.prenom} ${d.nom} (${d.trigramme||""})</p>
      <p><strong>Type :</strong> ${d.type_demande}</p>
      <p><strong>Date :</strong> ${new Date(d.date_debut).toLocaleDateString("fr-FR")}</p>
      <p><strong>Durée :</strong> ${d.type_demande==="RE" ? `${d.heures_re} h` : `${d.duree_jours} jour(s)`}</p>
      ${d.commentaire?`<p><strong>Commentaire :</strong> ${d.commentaire}</p>`:""}
      <p><strong>Décision :</strong> ${d.statut === "VALIDEE" ? "Validée" : "Refusée"}</p>${d.motif_refus ? `<p><strong>Motif du refus :</strong> ${d.motif_refus}</p>` : ""}
      <p><strong>Traitée par :</strong> ${me.prenom||""} ${me.nom||""}</p>
    `;

    const resend=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        from:Deno.env.get("RH_EMAIL_FROM")!,
        to:[emailRH],
        cc,
        subject:objet,
        html
      })
    });
    const result=await resend.json();
    if(!resend.ok) throw new Error(result?.message||"Resend a refusé l'envoi.");

    await admin.from("rh_demandes").update({
      rh_transmise:true,rh_transmise_le:new Date().toISOString(),rh_transmise_par:me.id,email_rh:emailRH,email_envoye_le:new Date().toISOString(),
      email_message_id:result?.id||null,updated_at:new Date().toISOString()
    }).eq("id",id);

    return new Response(JSON.stringify({ok:true,id:result?.id||null}),{headers:{...cors,"Content-Type":"application/json"}});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  }
});
