import { describe, expect, it } from "vitest";
import { asEngineMessage, saveKind } from "../lib/bridge";
import { posterAt, progressSeconds, readProbe, webArgs } from "../lib/media";
import { parseRange } from "../lib/serve";
import { titleFrom } from "../lib/videos";
import { videoExt } from "../lib/store";
import { projectName } from "../lib/projects";

const probe = (streams: unknown[], duration = "12.5") => readProbe(JSON.stringify({ format: { duration }, streams }));

describe("media", () => {
  it("reads ffprobe's answer", () => {
    expect(probe([{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, { codec_type: "audio", codec_name: "aac" }])).toEqual({
      duration: 12.5, width: 1920, height: 1080, video: "h264", audio: "aac", rotation: 0,
    });
    // A phone video recorded upright: stored sideways with a rotation.
    const phone = probe([{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }]);
    expect(phone).toMatchObject({ width: 1080, height: 1920, rotation: 90, audio: null });
    // Cover art is not the video.
    expect(probe([{ codec_type: "video", codec_name: "mjpeg" }]).video).toBeNull();
    expect(probe([], "N/A").duration).toBeNull();
  });

  it("copies H.264/AAC and re-encodes anything else", () => {
    const copy = webArgs(probe([{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }]), "in.mp4", "out.mp4");
    expect(copy.join(" ")).toContain("-c:v copy");
    expect(copy.join(" ")).toContain("-c:a copy");
    expect(copy).toContain("+faststart");
    const webm = webArgs(probe([{ codec_type: "video", codec_name: "vp9" }, { codec_type: "audio", codec_name: "opus" }]), "in.webm", "out.mp4");
    expect(webm.join(" ")).toContain("-c:v libx264");
    expect(webm.join(" ")).toContain("-c:a aac");
    expect(webm.at(-1)).toBe("out.mp4");
  });

  it("follows ffmpeg's progress and picks a poster moment", () => {
    expect(progressSeconds("out_time_us=2500000")).toBe(2.5);
    expect(progressSeconds("frame=10")).toBeNull();
    expect(posterAt(null)).toBe(0);
    expect(posterAt(20)).toBe(2);
    expect(posterAt(600)).toBe(5);
  });

  it("serves byte ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=2000-", 1000)).toBeNull();
    expect(parseRange("bytes=5-1", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });

  it("takes video files only and names things from them", () => {
    expect(videoExt("Team meeting.MOV")).toBe("mov");
    expect(videoExt("notes.txt")).toBeNull();
    expect(videoExt("mp4")).toBeNull();
    expect(titleFrom("C:\\Users\\x\\Q3_kickoff.final.mp4")).toBe("Q3 kickoff.final");
    expect(titleFrom(".mp4")).toBe("Untitled video");
    expect(projectName("../Promo")).toBe("Promo.fcproj");
    expect(projectName("Cut.FCPROJ")).toBe("Cut.FCPROJ");
  });
});

describe("editor bridge", () => {
  it("accepts only well-formed messages", () => {
    expect(asEngineMessage({ type: "filmcraft:ready" })).toEqual({ type: "filmcraft:ready" });
    const bytes = new ArrayBuffer(4);
    expect(asEngineMessage({ type: "filmcraft:save", name: "a.mp4", path: "/exports/a.mp4", bytes })).toEqual({ type: "filmcraft:save", name: "a.mp4", path: "/exports/a.mp4", bytes });
    expect(asEngineMessage({ type: "filmcraft:save", name: "a.mp4", bytes: "x" })).toBeNull();
    expect(asEngineMessage({ type: "photocraft:save" })).toBeNull();
    expect(asEngineMessage(null)).toBeNull();
  });

  it("sends exports to the library and projects to the shelf", () => {
    expect(saveKind("Sequence 01.mp4")).toBe("video");
    expect(saveKind("cut.MOV")).toBe("video");
    expect(saveKind("Promo.fcproj")).toBe("project");
    expect(saveKind("captions.srt")).toBe("download");
    expect(saveKind("frame.png")).toBe("download");
  });
});
