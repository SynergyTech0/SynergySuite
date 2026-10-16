"use client";
import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Presentation, Ruler,
} from "lucide-react";

const COLORS = {
  folder: "#e8a317", word: "#185abd", sheet: "#107c41", slides: "#c43e1c", pdf: "#d13438", image: "#8764b8",
  video: "#c239b3", audio: "#0099bc", code: "#5c6b7a", zip: "#986f0b", cad: "#00788a", other: "#6b7280",
};

export function FileIcon({ kind, name, size = 20 }: { kind: "file" | "folder"; name: string; size?: number }) {
  if (kind === "folder") return <Folder size={size} color={COLORS.folder} fill={COLORS.folder} fillOpacity={0.25} />;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const p = { size, strokeWidth: 1.75 };
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return <FileText {...p} color={COLORS.word} />;
  if (["xls", "xlsx", "ods", "csv", "tsv"].includes(ext)) return <FileSpreadsheet {...p} color={COLORS.sheet} />;
  if (["ppt", "pptx", "odp"].includes(ext)) return <Presentation {...p} color={COLORS.slides} />;
  if (ext === "pdf") return <FileText {...p} color={COLORS.pdf} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "tif", "tiff", "ico"].includes(ext)) return <FileImage {...p} color={COLORS.image} />;
  if (["mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi"].includes(ext)) return <FileVideo {...p} color={COLORS.video} />;
  if (["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"].includes(ext)) return <FileAudio {...p} color={COLORS.audio} />;
  if (["zip", "gz", "tar", "7z", "rar"].includes(ext)) return <FileArchive {...p} color={COLORS.zip} />;
  if (["dwg", "dxf"].includes(ext)) return <Ruler {...p} color={COLORS.cad} />;
  if (["js", "ts", "tsx", "jsx", "json", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "sh", "sql", "html", "css", "xml", "yaml", "yml", "md", "toml", "ini"].includes(ext)) {
    return <FileCode {...p} color={COLORS.code} />;
  }
  if (["txt", "log"].includes(ext)) return <FileText {...p} color={COLORS.other} />;
  return <File {...p} color={COLORS.other} />;
}
