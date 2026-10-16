import { spawnSync } from "child_process";

/**
 * Run a local Python (or Node) worker synchronously and return stdout as a string.
 * Cleans up stderr and trims whitespace to avoid invalid JSON parsing.
 */
function runWorker(scriptName: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Adjust worker path
      const workerPath = `${process.cwd()}/workers/${scriptName}`;

      const result = spawnSync("python3", [workerPath, ...args], {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 20, // 20MB buffer for large PDFs
      });

      if (result.error) {
        return reject(result.error);
      }

      if (result.status !== 0) {
        console.error("⚠️ Analyzer stderr:", result.stderr?.slice(0, 200));
      }

      // Combine stdout and stderr (sometimes analyzers write mixed output)
      const output = (result.stdout || "").trim();
      if (!output) {
        return reject(new Error("Analyzer returned empty output"));
      }

      // Remove stray warnings / invalid characters that break JSON
      const sanitized = output
        .replace(/^[^{[]+/, "") // strip leading junk before JSON
        .replace(/[^}\]]+$/, ""); // strip trailing junk after JSON

      resolve(sanitized);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Calls the external PDF analyzer worker script.
 * @param filePath Absolute path to the uploaded document
 * @returns JSON { summary: string, fields: [] }
 */
export async function analyzeDocumentHeuristically(filePath: string) {
  try {
    const result = await runWorker("analyzer.py", [filePath]);

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      console.warn("⚠️ Analyzer returned non-JSON:", result?.slice(0, 200));
      parsed = { summary: null, fields: [] };
    }

    return parsed;
  } catch (err) {
    console.error("❌ PDF Analyzer Worker Error:", err);
    return { summary: null, fields: [] };
  }
}
