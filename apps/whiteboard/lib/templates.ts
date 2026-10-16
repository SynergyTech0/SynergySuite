/**
 * Board templates and sticky notes, as Excalidraw element skeletons (the browser turns them into
 * full elements with convertToExcalidrawElements). Plain data, so the server can check a template
 * name and tests can check the layouts without a browser.
 */

export type Skeleton = { type: string; id?: string; [k: string]: unknown };

export const STICKY_SIZE = 200;

/** Sticky note colours, like Microsoft Whiteboard's. */
export const STICKY_COLORS: { id: string; name: string; fill: string; stroke: string }[] = [
  { id: "yellow", name: "Yellow", fill: "#ffec99", stroke: "#f08c00" },
  { id: "pink", name: "Pink", fill: "#ffc9c9", stroke: "#e03131" },
  { id: "green", name: "Green", fill: "#b2f2bb", stroke: "#2f9e44" },
  { id: "blue", name: "Blue", fill: "#a5d8ff", stroke: "#1971c2" },
  { id: "purple", name: "Purple", fill: "#d0bfff", stroke: "#6741d9" },
  { id: "orange", name: "Orange", fill: "#ffd8a8", stroke: "#e8590c" },
];

function colorOf(id: string) {
  return STICKY_COLORS.find((c) => c.id === id) ?? STICKY_COLORS[0];
}

/** A sticky note: a filled square with its words inside, centred. */
export function sticky(x: number, y: number, color = "yellow", words = "", id?: string): Skeleton {
  const c = colorOf(color);
  return {
    type: "rectangle",
    ...(id ? { id } : {}),
    x,
    y,
    width: STICKY_SIZE,
    height: STICKY_SIZE,
    backgroundColor: c.fill,
    strokeColor: c.stroke,
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    customData: { sticky: true },
    ...(words ? { label: { text: words, fontSize: 20, strokeColor: "#1e1e1e" } } : {}),
  };
}

/** Sticky notes in rows of `perRow`, `gap` apart, starting at (x, y). */
export function stickyGrid(words: string[], x: number, y: number, opts: { perRow?: number; color?: string | string[]; gap?: number; idPrefix?: string } = {}): Skeleton[] {
  const perRow = opts.perRow ?? 4;
  const gap = opts.gap ?? 24;
  return words.map((w, i) => {
    const color = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color ?? "yellow";
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    return sticky(x + col * (STICKY_SIZE + gap), y + row * (STICKY_SIZE + gap), color, w, opts.idPrefix ? `${opts.idPrefix}${i}` : undefined);
  });
}

function heading(id: string, x: number, y: number, words: string, fontSize = 36): Skeleton {
  return { type: "text", id, x, y, text: words, fontSize, strokeColor: "#1e1e1e" };
}

/** A locked background panel with a title, for columns and quadrants people drop notes onto. */
function panel(id: string, x: number, y: number, width: number, height: number, title: string, fill: string): Skeleton[] {
  return [
    { type: "rectangle", id, x, y, width, height, backgroundColor: fill, strokeColor: "#ced4da", fillStyle: "solid", strokeWidth: 1, roughness: 0, roundness: { type: 3 }, locked: true },
    { ...heading(`${id}-title`, x + 24, y + 20, title, 28), locked: true },
  ];
}

function columns(prefix: string, titles: string[], fills: string[], notes: string[][]): Skeleton[] {
  const width = 2 * STICKY_SIZE + 3 * 24;
  const out: Skeleton[] = [];
  titles.forEach((t, i) => {
    const x = i * (width + 40);
    out.push(...panel(`${prefix}-col${i}`, x, 80, width, 900, t, fills[i % fills.length]));
    out.push(...stickyGrid(notes[i] ?? [], x + 24, 160, { perRow: 2, color: STICKY_COLORS[i % STICKY_COLORS.length].id, idPrefix: `${prefix}-n${i}-` }));
  });
  return out;
}

export type Template = { id: string; name: string; description: string; build: () => Skeleton[] };

export const TEMPLATES: Template[] = [
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "A question in the middle and room for everyone's ideas",
    build: () => [
      heading("bs-title", 0, 0, "Brainstorm", 44),
      { type: "rectangle", id: "bs-topic", x: 0, y: 90, width: 920, height: 120, backgroundColor: "#e7f5ff", strokeColor: "#1971c2", fillStyle: "solid", roughness: 0, roundness: { type: 3 }, label: { text: "What are we solving?", fontSize: 28 } },
      ...stickyGrid(["Idea", "Idea", "Idea", "Idea", "Idea", "Idea", "Idea", "Idea"], 0, 250, { perRow: 4, color: ["yellow", "pink", "green", "blue"], idPrefix: "bs-n" }),
    ],
  },
  {
    id: "kanban",
    name: "Kanban",
    description: "To do, Doing and Done columns to move notes across",
    build: () => [heading("kb-title", 0, 0, "Kanban board", 44), ...columns("kb", ["To do", "Doing", "Done"], ["#f8f9fa"], [["Task", "Task", "Task"], ["Task"], []])],
  },
  {
    id: "retro",
    name: "Retrospective",
    description: "What went well, what to improve and the actions to take",
    build: () => [
      heading("rt-title", 0, 0, "Retrospective", 44),
      ...columns("rt", ["Went well", "To improve", "Actions"], ["#ebfbee", "#fff5f5", "#e7f5ff"], [["", ""], ["", ""], [""]]),
    ],
  },
  {
    id: "swot",
    name: "SWOT analysis",
    description: "Strengths, weaknesses, opportunities and threats",
    build: () => {
      const size = 2 * STICKY_SIZE + 3 * 24;
      const quads: [string, string, number, number][] = [
        ["Strengths", "#ebfbee", 0, 0], ["Weaknesses", "#fff5f5", 1, 0], ["Opportunities", "#e7f5ff", 0, 1], ["Threats", "#fff9db", 1, 1],
      ];
      return [
        heading("sw-title", 0, 0, "SWOT analysis", 44),
        ...quads.flatMap(([t, fill, cx, cy], i) => panel(`sw-q${i}`, cx * (size + 24), 80 + cy * (size + 24), size, size, t, fill)),
      ];
    },
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "A central idea with branches",
    build: () => {
      const branches = ["Branch", "Branch", "Branch", "Branch", "Branch", "Branch"];
      const out: Skeleton[] = [
        { type: "ellipse", id: "mm-center", x: -160, y: -70, width: 320, height: 140, backgroundColor: "#d0bfff", strokeColor: "#6741d9", fillStyle: "solid", roughness: 0, label: { text: "Main idea", fontSize: 28 } },
      ];
      branches.forEach((b, i) => {
        const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
        const cx = Math.round(Math.cos(angle) * 480);
        const cy = Math.round(Math.sin(angle) * 300);
        out.push({ type: "rectangle", id: `mm-b${i}`, x: cx - 110, y: cy - 45, width: 220, height: 90, backgroundColor: STICKY_COLORS[i % STICKY_COLORS.length].fill, strokeColor: STICKY_COLORS[i % STICKY_COLORS.length].stroke, fillStyle: "solid", roughness: 0, roundness: { type: 3 }, label: { text: b, fontSize: 20 } });
        out.push({ type: "arrow", id: `mm-a${i}`, x: 0, y: 0, start: { id: "mm-center" }, end: { id: `mm-b${i}` }, strokeColor: "#495057", endArrowhead: null });
      });
      return out;
    },
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Start, steps, a decision and an end, joined up",
    build: () => {
      const shape = (id: string, type: string, x: number, y: number, words: string, fill: string, w = 220, h = 100): Skeleton => ({
        type, id, x, y, width: w, height: h, backgroundColor: fill, strokeColor: "#1e1e1e", fillStyle: "solid", roughness: 0, ...(type === "rectangle" ? { roundness: { type: 3 } } : {}), label: { text: words, fontSize: 20 },
      });
      const arrow = (id: string, from: string, to: string, words?: string): Skeleton => ({
        type: "arrow", id, x: 0, y: 0, start: { id: from }, end: { id: to }, strokeColor: "#1e1e1e", ...(words ? { label: { text: words, fontSize: 16 } } : {}),
      });
      return [
        heading("fc-title", 0, -120, "Flowchart", 44),
        shape("fc-start", "ellipse", 0, 0, "Start", "#b2f2bb"),
        shape("fc-step1", "rectangle", 0, 200, "Step", "#a5d8ff"),
        shape("fc-decide", "diamond", -20, 400, "Decision?", "#ffec99", 260, 160),
        shape("fc-step2", "rectangle", 400, 430, "Step", "#a5d8ff"),
        shape("fc-end", "ellipse", 0, 680, "End", "#ffc9c9"),
        arrow("fc-a1", "fc-start", "fc-step1"),
        arrow("fc-a2", "fc-step1", "fc-decide"),
        arrow("fc-a3", "fc-decide", "fc-end", "Yes"),
        arrow("fc-a4", "fc-decide", "fc-step2", "No"),
      ];
    },
  },
  {
    id: "weekly",
    name: "Weekly planner",
    description: "A column for each working day",
    build: () => [heading("wk-title", 0, 0, "This week", 44), ...columns("wk", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], ["#f8f9fa"], [])],
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
