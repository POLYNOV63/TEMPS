"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    async function terminerConnexion() {
      const { data, error } =
        await supabase.auth.exchangeCodeForSession(
          window.location.href
        );

      console.log("SESSION", data);
      console.log("ERROR", error);

      router.replace("/dashboard");
    }

    terminerConnexion();
  }, [router]);

  return (
    <div style={{ padding: 40 }}>
      Connexion Microsoft en cours...
    </div>
  );
}