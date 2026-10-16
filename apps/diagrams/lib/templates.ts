/**
 * The starting points on the home page, the way Visio's gallery groups them. Each is one of the
 * templates that ship with draw.io (CC BY 4.0, served from /drawio/templates/), with its own
 * preview picture beside it. "More templates" in the gallery opens draw.io's full template list.
 */
export type Template = { id: string; name: string; category: string; file: string | null };

export const CATEGORIES = ["Basic", "Flowchart", "Organization", "Network", "Software", "Business", "Maps and plans"] as const;

export const TEMPLATES: Template[] = [
  { id: "blank", name: "Blank diagram", category: "Basic", file: null },
  { id: "block", name: "Block diagram", category: "Basic", file: "other/block" },
  { id: "venn", name: "Venn diagram", category: "Basic", file: "venn/venn_1" },
  { id: "flowchart", name: "Basic flowchart", category: "Flowchart", file: "basic/flowchart" },
  { id: "flowchart-2", name: "Flowchart", category: "Flowchart", file: "flowcharts/flowchart_1" },
  { id: "cross-functional", name: "Cross-functional flowchart", category: "Flowchart", file: "flowcharts/cross_functional_flowchart_1" },
  { id: "swimlanes", name: "Swimlanes", category: "Flowchart", file: "basic/swimlanes" },
  { id: "data-flow", name: "Data flow", category: "Flowchart", file: "flowcharts/data_flow_1" },
  { id: "workflow", name: "Workflow", category: "Flowchart", file: "flowcharts/workflow_1" },
  { id: "orgchart", name: "Org chart", category: "Organization", file: "basic/orgchart" },
  { id: "raci", name: "Responsibility matrix", category: "Organization", file: "tables/authority_matrix" },
  { id: "lan", name: "Network diagram", category: "Network", file: "network/lan" },
  { id: "enterprise", name: "Enterprise network", category: "Network", file: "network/enterprise_1" },
  { id: "active-directory", name: "Active Directory", category: "Network", file: "network/active_directory" },
  { id: "home-network", name: "Home network", category: "Network", file: "network/wireless_home_network" },
  { id: "uml-class", name: "UML class diagram", category: "Software", file: "basic/classes" },
  { id: "sequence", name: "UML sequence", category: "Software", file: "basic/sequence" },
  { id: "activity", name: "UML activity", category: "Software", file: "uml/activity_diagram_1" },
  { id: "state", name: "State machine", category: "Software", file: "uml/state_machine" },
  { id: "erd", name: "Database (ER) diagram", category: "Software", file: "basic/erd" },
  { id: "bpmn", name: "BPMN process", category: "Business", file: "business/bpmn" },
  { id: "timeline", name: "Timeline", category: "Business", file: "business/timeline_1" },
  { id: "gantt", name: "Gantt chart", category: "Business", file: "tables/gantt_1" },
  { id: "kanban", name: "Kanban board", category: "Business", file: "basic/kanban" },
  { id: "fishbone", name: "Cause and effect", category: "Business", file: "business/ishikawa_1" },
  { id: "canvas", name: "Business model canvas", category: "Business", file: "business/business_model_canvas_1" },
  { id: "mindmap", name: "Mind map", category: "Maps and plans", file: "basic/mindmap" },
  { id: "concept", name: "Concept map", category: "Maps and plans", file: "maps/concept_map_1" },
  { id: "floor-plan", name: "Floor plan", category: "Maps and plans", file: "other/floor_plan" },
  { id: "site-map", name: "Site map", category: "Maps and plans", file: "maps/site_map" },
  { id: "wireframe", name: "Wireframe", category: "Maps and plans", file: "wireframes/home_page_1" },
];

export const FEATURED = ["blank", "flowchart", "cross-functional", "orgchart", "lan", "uml-class", "erd", "timeline"];

export function templateXmlUrl(t: Template): string | null {
  return t.file ? `/drawio/templates/${t.file}.xml` : null;
}

export function templatePreviewUrl(t: Template): string | null {
  return t.file ? `/drawio/templates/${t.file}.png` : null;
}
