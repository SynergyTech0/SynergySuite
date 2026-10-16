/**
 * Node.js wrapper for Python OpenCV
 * Uses Python's stable OpenCV bindings via child_process
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execFile);
const PYTHON_SCRIPT = path.join(process.cwd(), "scripts/opencv_preprocess.py");

export interface PreprocessOptions {
  deskew?: boolean;
  denoise?: boolean;
  binarize?: boolean;
  enhanceContrast?: boolean;
  removeBackground?: boolean;
}

export interface DetectedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "checkbox" | "textbox" | "signature_area";
  area: number;
  aspectRatio: number;
}

/**
 * Preprocess image using OpenCV
 */
export async function preprocessImage(
  inputPath: string,
  outputPath: string,
  options: PreprocessOptions = {}
): Promise<{ success: boolean; outputPath?: string; skewAngle?: number; error?: string }> {
  try {
    const optionsJson = JSON.stringify(options);

    const { stdout } = await exec("python3", [
      PYTHON_SCRIPT,
      "preprocess",
      inputPath,
      outputPath,
      optionsJson,
    ]);

    const result = JSON.parse(stdout);
    return result;
  } catch (err: any) {
    console.error("OpenCV preprocessing failed:", err);
    return {
      success: false,
      error: err.message || "Preprocessing failed",
    };
  }
}

/**
 * Detect form boxes (checkboxes, text fields, signature areas)
 */
export async function detectFormBoxes(
  imagePath: string
): Promise<{ success: boolean; boxes?: DetectedBox[]; count?: number; error?: string }> {
  try {
    const { stdout } = await exec("python3", [
      PYTHON_SCRIPT,
      "detect_boxes",
      imagePath,
    ]);

    const result = JSON.parse(stdout);
    return result;
  } catch (err: any) {
    console.error("Box detection failed:", err);
    return {
      success: false,
      error: err.message || "Box detection failed",
    };
  }
}

/**
 * Test OpenCV installation
 */
export async function testOpenCV(): Promise<{
  success: boolean;
  opencvVersion?: string;
  pythonVersion?: string;
  error?: string;
}> {
  try {
    const { stdout } = await exec("python3", [PYTHON_SCRIPT, "test"]);
    const result = JSON.parse(stdout);
    return result;
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "OpenCV test failed",
    };
  }
}
