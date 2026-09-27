import { NextResponse } from "next/server";
import fs from "fs";

export async function GET() {
  const files = fs.readdirSync(process.cwd());

  return new NextResponse(
    files.join("\n")
  );
}