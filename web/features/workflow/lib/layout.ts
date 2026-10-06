import type { Atom, FlowSpec, Group, IconName, NodeStatus } from "../model/types";

export const NODE_SPACING = 230;
export const HANDLE_OFFSET = 46;

export type LayoutNode = {
  key: string;
  x: number;
  title: string;
  icon: IconName;
  status: NodeStatus;
  summary: string;
  trigger: boolean;
  hasInput: boolean;
  atoms: Atom[];
};

export type LayoutEdge = { key: string; fromX: number; toX: number; status: NodeStatus; label: string };
export type LayoutFrame = { key: string; title: string; x1: number; x2: number };
export type Layout = { nodes: LayoutNode[]; edges: LayoutEdge[]; frames: LayoutFrame[]; minX: number; maxX: number };

// One node for a whole group, so its status is the sum of the steps inside it.
export function groupStatus(statuses: NodeStatus[]): NodeStatus {
  if (statuses.includes("running")) return "running";
  if (statuses.includes("error")) return "error";
  const done = statuses.filter((s) => s === "success").length;
  const skipped = statuses.filter((s) => s === "skipped").length;
  if (done + skipped === statuses.length) return done > 0 ? "success" : "skipped";
  return done + skipped > 0 ? "running" : "idle";
}

export function buildLayout(flow: FlowSpec, exploded: boolean): Layout {
  const groups = new Map<string, Group>(flow.groups.map((g) => [g.id, g]));
  const nodes: LayoutNode[] = [];
  const frames: LayoutFrame[] = [];

  let i = 0;
  while (i < flow.atoms.length) {
    const atom = flow.atoms[i];
    const group = atom.group ? groups.get(atom.group) : undefined;
    if (!group) {
      nodes.push({ key: atom.id, x: 0, title: atom.title, icon: atom.icon, status: atom.status, summary: atom.summary, trigger: Boolean(atom.trigger), hasInput: nodes.length > 0, atoms: [atom] });
      i += 1;
      continue;
    }
    const members: Atom[] = [];
    while (i < flow.atoms.length && flow.atoms[i].group === group.id) members.push(flow.atoms[i++]);

    if (exploded) {
      const first = nodes.length;
      for (const m of members) {
        nodes.push({ key: m.id, x: 0, title: m.title, icon: m.icon, status: m.status, summary: m.summary, trigger: false, hasInput: true, atoms: [m] });
      }
      frames.push({ key: group.id, title: group.title, x1: first, x2: nodes.length - 1 });
    } else {
      const status = groupStatus(members.map((m) => m.status));
      const lines = members.filter((m) => m.status !== "idle" && m.status !== "skipped").map((m) => m.summary);
      nodes.push({
        key: group.id,
        x: 0,
        title: group.title,
        icon: group.icon,
        status,
        summary: lines.length ? lines[0] : members[0].summary,
        trigger: false,
        hasInput: true,
        atoms: members,
      });
    }
  }

  nodes.forEach((n, index) => (n.x = index * NODE_SPACING));

  const edges: LayoutEdge[] = nodes.slice(1).map((n, index) => ({
    key: `${nodes[index].key}-${n.key}`,
    fromX: nodes[index].x + HANDLE_OFFSET,
    toX: n.x - HANDLE_OFFSET,
    status: n.status,
    label: n.atoms[0].inLabel,
  }));

  return {
    nodes,
    edges,
    // Frame positions are stored as node indexes above and turned into x positions here.
    frames: frames.map((f) => ({ ...f, x1: nodes[f.x1].x, x2: nodes[f.x2].x })),
    minX: 0,
    maxX: nodes[nodes.length - 1].x,
  };
}
