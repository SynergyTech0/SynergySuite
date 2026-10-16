import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const apiDir = path.join(process.cwd(), "src/app/api");

  function getRoutes(dir: string, base: string = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let routes: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        const routePath = path.join(base, entry.name);

        // If folder contains route.ts → it’s an endpoint
        if (fs.existsSync(path.join(fullPath, "route.ts"))) {
          routes.push(`/api${routePath}`);
        }

        // Recurse deeper
        routes.push(...getRoutes(fullPath, routePath));
      }
    }

    return routes;
  }

  const endpoints = getRoutes(apiDir);

  return NextResponse.json({ endpoints });
}
