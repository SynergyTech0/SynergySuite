"use client";

// 3D models on slides. One shared WebGL renderer (three.js, loaded when a
// model is first shown) draws every model; each view copies its picture into
// its own 2D canvas, so thumbnails and the slide show do not each need a WebGL
// context. Under the canvas sits the stored poster, which is what offscreen
// pictures (PDF, video, zoom thumbnails) and a browser without WebGL show.
import { useEffect, useRef, useState } from "react";
import type { Model3dEl } from "@/lib/slides/model";
import { dragTurn, fitDistance, type Turn } from "@/lib/slides/model3d";

type Three = typeof import("three");
type Loaded = { root: import("three").Object3D; center: import("three").Vector3; radius: number };
type Engine = { THREE: Three; renderer: import("three").WebGLRenderer; scene: import("three").Scene; camera: import("three").PerspectiveCamera; pivot: import("three").Group };

let engine: Promise<Engine | null> | null = null;
const models = new Map<string, Promise<Loaded | null>>();
const FOV = 30;

function getEngine(): Promise<Engine | null> {
  engine ??= (async () => {
    try {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const canvas = document.createElement("canvas");
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // neutral tone mapping keeps the model's own colours (filmic curves wash them out)
      renderer.toneMapping = THREE.NeutralToneMapping;
      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.6;
      const sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.set(2, 3, 4);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
      const pivot = new THREE.Group();
      scene.add(pivot);
      return { THREE, renderer, scene, camera, pivot };
    } catch {
      return null; // no WebGL here: posters only
    }
  })();
  return engine;
}

/** The model at `src`, centred on its pivot (cached; null when it cannot be read). */
function loadModel(src: string): Promise<Loaded | null> {
  let p = models.get(src);
  if (!p) {
    p = (async () => {
      const e = await getEngine();
      if (!e) return null;
      const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/loaders/DRACOLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      try {
        // compressed meshes: Draco (its decoder is served from three's own copy) and meshopt
        const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath("/api/slides/draco/")).setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(src);
        const root = gltf.scene;
        const box = new e.THREE.Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new e.THREE.Sphere());
        return { root, center: sphere.center.clone(), radius: sphere.radius || 1 };
      } catch {
        return null;
      }
    })();
    models.set(src, p);
    if (models.size > 24) models.delete(models.keys().next().value!);
  }
  return p;
}

/**
 * Draw a model turned `t` into the shared renderer at w x h device pixels and
 * hand its canvas to `use` straight away (before another view draws over it).
 */
async function drawModel<T>(src: string, t: Turn, w: number, h: number, use: (c: HTMLCanvasElement) => T): Promise<T | null> {
  const [e, m] = await Promise.all([getEngine(), loadModel(src)]);
  if (!e || !m) return null;
  const { THREE, renderer, scene, camera, pivot } = e;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  pivot.clear();
  // the model turns about its own centre
  const holder = new THREE.Group();
  m.root.position.set(-m.center.x, -m.center.y, -m.center.z);
  holder.add(m.root);
  pivot.add(holder);
  pivot.rotation.set((t.rx * Math.PI) / 180, (t.ry * Math.PI) / 180, (t.rz * Math.PI) / 180, "YXZ");
  camera.aspect = w / h;
  const d = fitDistance(m.radius, FOV, camera.aspect) * 1.02;
  camera.position.set(0, 0, d);
  camera.near = Math.max(0.001, d - m.radius * 2);
  camera.far = d + m.radius * 2;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  pivot.clear();
  return use(renderer.domElement);
}

const MAX_PX = 2048;
const turnOf = (el: Model3dEl): Turn => ({ rx: el.rx || 0, ry: el.ry || 0, rz: el.rz || 0 });

/** A PNG of the model as it is turned, at most `max` pixels on its long side (null without WebGL or the model). */
export async function modelPoster(el: Model3dEl, max = 800): Promise<string | null> {
  const k = Math.min(1, max / Math.max(el.w, el.h, 1));
  const w = Math.max(16, Math.round(el.w * k * 1.5)), h = Math.max(16, Math.round(el.h * k * 1.5));
  return drawModel(el.src, turnOf(el), Math.min(w, MAX_PX), Math.min(h, MAX_PX), (c) => c.toDataURL("image/png"));
}

/** Whether the model at `src` loads (for the insert dialog). */
export async function modelLoads(src: string): Promise<boolean> {
  return !!(await loadModel(src));
}

export function ModelView({ el }: { el: Model3dEl }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rx = el.rx || 0, ry = el.ry || 0, rz = el.rz || 0;
  // once the model itself is drawn the poster underneath would show around it
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c || !el.src) return;
    let live = true;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(async () => {
        const r = c.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(8, Math.min(MAX_PX, Math.round(r.width * dpr))), h = Math.max(8, Math.min(MAX_PX, Math.round(r.height * dpr)));
        if (!r.width || !r.height) return;
        const ok = await drawModel(el.src, { rx, ry, rz }, w, h, (src) => {
          if (!live) return false;
          c.width = w;
          c.height = h;
          const g = c.getContext("2d");
          g?.clearRect(0, 0, w, h);
          g?.drawImage(src, 0, 0);
          return true;
        });
        if (ok && live) setDrawn(true);
      });
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [el.src, rx, ry, rz]);
  return (
    <div data-model3d="" style={{ position: "absolute", inset: 0 }}>
      {el.poster && !drawn && <img src={el.poster} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }} />}
      <canvas ref={ref} data-testid="model3d-canvas" data-drawn={drawn ? "1" : undefined} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
}

/**
 * The 3D rotate handle in the middle of a selected model: drag across to turn
 * it, up and down to tilt it. `onLive` shows the turn while dragging; `onDone`
 * commits it once.
 */
export function ModelTurnHandle({ el, scale, onLive, onDone }: { el: Model3dEl; scale: number; onLive: (t: Turn | null) => void; onDone: (t: Turn) => void }) {
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const start = turnOf(el);
    let last: Turn | null = null;
    const move = (ev: PointerEvent) => {
      last = dragTurn(start, ev.clientX - x0, ev.clientY - y0);
      onLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onLive(null);
      if (last) onDone(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      data-testid="model3d-turn"
      title="Drag to turn or tilt the 3D model"
      onPointerDown={down}
      style={{ position: "absolute", left: "50%", top: "50%", width: 44, height: 44, marginLeft: -22, marginTop: -22, transform: `scale(${1 / scale})`, zIndex: 5, cursor: "grab", touchAction: "none" }}
    >
      <svg viewBox="0 0 44 44" width={44} height={44}>
        <circle cx={22} cy={22} r={20} fill="rgba(255,255,255,0.85)" stroke="#4f46e5" strokeWidth={2} />
        <ellipse cx={22} cy={22} rx={13} ry={5} fill="none" stroke="#4f46e5" strokeWidth={2} />
        <ellipse cx={22} cy={22} rx={5} ry={13} fill="none" stroke="#4f46e5" strokeWidth={2} />
        <circle cx={22} cy={22} r={2.5} fill="#4f46e5" />
      </svg>
    </div>
  );
}
