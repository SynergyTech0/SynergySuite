// scripts/pdf-analyzer.mjs
import fs from "fs";
import { createRequire } from "module";

// ✅ Proper CommonJS import inside ESM
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

async function analyzePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);

  const text = data.text || "";
  const summary =
    text.slice(0, 500).replace(/\s+/g, " ") +
    (text.length > 500 ? "...": "");

  const suggestedFields = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes("signature"))
      suggestedFields.push({ label: "Signature", x: 100, y: 700 - i * 10, width: 150, height: 40 });
    if (line.includes("date"))
      suggestedFields.push({ label: "Date", x: 300, y: 700 - i * 10, width: 100, height: 30 });
    if (line.includes("name") || line.includes("print"))
      suggestedFields.push({ label: "Name", x: 100, y: 700 - i * 10, width: 200, height: 30 });
  }

  return { summary, numPages: data.numpages || 1, suggestedFields };
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("❌ No PDF file provided.");
  process.exit(1);
}

try {
  const result = await analyzePDF(filePath);
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  console.error("❌ PDF Analyzer error:", err);
  process.exit(1);
}
