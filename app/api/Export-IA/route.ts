import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";



function getFiles(
  dir: string,
  result: string[] = []
): string[] {



  
  const entries = fs.readdirSync(dir);

  

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (
      stat.isDirectory() &&
      ![".next", "node_modules", ".git"].includes(entry)
    ) {
      getFiles(fullPath, result);
    }

if (
  stat.isFile() &&
  !entry.startsWith(".env") &&
  (
    entry.endsWith(".ts") ||
    entry.endsWith(".tsx") ||
    entry.endsWith(".js") ||
    entry.endsWith(".jsx") ||
    entry.endsWith(".json") ||
    entry.endsWith(".sql") ||
    entry.endsWith(".css") ||
    entry.endsWith(".md")
  )
) {
  result.push(fullPath);
}
  }

  return result;
}

export async function GET() {
const root = process.cwd();

const files = getFiles(root);

console.log("ROOT =", root);
console.log("FILES =", files.length);
console.log(files.slice(0, 20));

const supabase = createClient(
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

let supabaseExport = null;

try {
  const { data } = await supabase.rpc(
    "export_ai_context"
  );

  supabaseExport = data;
} catch (error) {
  console.error(error);
}
  

  let output = `
==================================================
POLYNOV AI CONTEXT
==================================================

DATE :
${new Date().toISOString()}

NB FICHIERS :
${files.length}

`;

output += `
==================================================
SUPABASE
==================================================

${JSON.stringify(
  supabaseExport,
  null,
  2
)}

`;


  for (const file of files) {
    const relative = path.relative(root, file);

    let content = "";

    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

output += `


==================================================
FICHIER
==================================================

${relative}

--------------------------------------------------
CONTENU
--------------------------------------------------

${content}

`;
  }

return new NextResponse(output, {
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition":
      'attachment; filename="POLYNOV_AI_CONTEXT.txt"',
  },
});
}

