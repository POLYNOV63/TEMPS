"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    async function terminerConnexion() {
      try {
        const { error } =
          await supabase.auth.exchangeCodeForSession(
            window.location.href
          );

        if (error) {
          console.error(error);
          router.replace("/login");
          return;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user?.email) {
          const { data: collab } = await supabase
            .from("collaborateurs")
            .select("id, auth_user_id")
            .eq("email", user.email)
            .maybeSingle();

          if (collab && !collab.auth_user_id) {
            await supabase
              .from("collaborateurs")
              .update({
                auth_user_id: user.id,
              })
              .eq("id", collab.id);

            console.log(
              "Collaborateur associé automatiquement :",
              user.email
            );
          }
        }

        router.replace("/dashboard");
      } catch (e) {
        console.error(e);
        router.replace("/login");
      }
    }

    terminerConnexion();
  }, [router]);

  return (
    <div style={{ padding: 40 }}>
      Connexion Microsoft en cours...
    </div>
  );
}