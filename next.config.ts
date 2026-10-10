import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export IA : inclut les fichiers du projet dans la fonction déployée, pour
  // que l'export contienne le code source (et pas seulement la base de données).
  outputFileTracingIncludes: {
    "/api/Export-IA": [
      "./app/**/*",
      "./components/**/*",
      "./lib/**/*",
      "./docs/**/*",
      "./supabase/functions/**/*",
      "./package.json",
      "./tsconfig.json",
      "./next.config.ts",
    ],
  },
};

export default nextConfig;
