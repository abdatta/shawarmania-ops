#!/usr/bin/env node
// Reconcile the ROADMAP.md status columns from actual folder state.
//
// Deterministic and agent-agnostic — run it from Claude, Codex, or a plain
// shell (`npm run roadmap:sync`). It derives each change's lifecycle state from
// the changes/ and archive/ folders and rewrites TWO cells of each inventory
// row: the leading status-icon cell (a glyph checklist that fills up as changes
// complete) and the Status word cell. The roadmap is a computed board rather
// than a manually stamped one. Idempotent: repeated runs converge.
//
// Lifecycle derivation (per change name in the inventory table):
//   archived  → a folder `openspec/changes/archive/<YYYY-MM-DD>-<name>/` exists
//               → Status `**archived YYYY-MM-DD**`, icon ✅
//   active    → `openspec/changes/<name>/tasks.md` exists AND has a checked task
//               → Status `active`, icon 🔄
//   proposed  → `tasks.md` exists but nothing checked → Status `proposed`, icon 📝
//   seeded    → the folder exists with no tasks.md → Status `seeded`, blank icon
//   (skipped) → no folder anywhere: the row is left untouched
//
// The leading icon cell and the Status word cell are always written from the
// same derivation, so they cannot drift from each other. If an inventory row is
// missing the leading icon cell (e.g. a freshly hand-added row), it is inserted;
// rows that already have it keep their column count. Rows are never inserted or
// removed, and no other cell (model, deps, checkpoint) is touched. The table
// header and separator rows carry no change number, so they are left as authored.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const openspecDir = path.resolve(scriptDir, ".."); // openspec/
const changesDir = path.join(openspecDir, "changes");
const roadmapPath = path.join(changesDir, "ROADMAP.md");
const archiveDir = path.join(changesDir, "archive");

// Status → checklist glyph. A to-do list that completes left to right: seeded is
// blank (a not-yet-started line, no glyph) → 📝 spec drafted → 🔄 work spinning →
// ✅ done. This map is the single source of the icon set; the Status-column
// legend in ROADMAP.md and the lifecycle skills (propose 📝 / apply 🔄 /
// archive ✅) echo it, so swap here and update those two spots to re-theme the
// whole board.
const ICONS = { seeded: "", proposed: "📝", active: "🔄", archived: "✅" };

function iconFor(status) {
  if (status.startsWith("**archived")) return ICONS.archived;
  return ICONS[status] ?? "";
}

if (!fs.existsSync(roadmapPath)) {
  console.log(`No roadmap at ${roadmapPath}; nothing to reconcile.`);
  process.exit(0);
}

// name -> archive date, from `<YYYY-MM-DD>-<name>` archive folders.
const archivedByName = new Map();
if (fs.existsSync(archiveDir)) {
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (m) archivedByName.set(m[2], m[1]);
  }
}

function deriveStatus(name) {
  const archivedDate = archivedByName.get(name);
  if (archivedDate) return `**archived ${archivedDate}**`;
  const dir = path.join(changesDir, name);
  if (!fs.existsSync(dir)) return null; // not present anywhere → leave as-is
  const tasksPath = path.join(dir, "tasks.md");
  if (fs.existsSync(tasksPath)) {
    const tasks = fs.readFileSync(tasksPath, "utf8");
    return /^\s*[-*]\s*\[x\]/im.test(tasks) ? "active" : "proposed";
  }
  return "seeded";
}

const isNumberCell = (c) => /^\s*\d+\s*$/.test(c);
const nameOf = (c) => c.match(/`([^`]+)`/);

const src = fs.readFileSync(roadmapPath, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const lines = src.split(/\r?\n/);
const changed = [];
let modified = false;

// Inventory rows are the only table rows whose first data cell is a bare change
// number immediately followed by a `backticked-name` cell. Working on split
// cells (rather than a monster regex) tolerates both the pre-icon layout
// (`| # | ...`) and the current layout (`| icon | # | ...`) and never matches
// the other tables in this file. Layout columns after normalisation:
//   0:''  1:icon  2:number  3:change  4:model  5:status  6:deps  7:checkpoint  8:''
const ICON_COL = 1;
const STATUS_COL = 5;

const out = lines.map((line) => {
  if (!line.startsWith("|")) return line;
  const cells = line.split("|");
  const numIdx = cells.findIndex(isNumberCell);
  if (numIdx !== 1 && numIdx !== 2) return line; // not an inventory row
  const nameMatch = nameOf(cells[numIdx + 1] ?? "");
  if (!nameMatch) return line; // number cell not followed by a `name` → skip
  const name = nameMatch[1].trim();
  const derived = deriveStatus(name);
  if (derived == null) return line; // no folder → untouched
  const icon = iconFor(derived);

  if (numIdx === 1) cells.splice(ICON_COL, 0, ` ${icon} `); // insert missing icon cell
  else cells[ICON_COL] = ` ${icon} `; // rewrite existing icon cell
  if (cells[STATUS_COL] === undefined) return line; // malformed row → leave alone
  const prevStatus = cells[STATUS_COL].trim();
  cells[STATUS_COL] = ` ${derived} `;

  const rebuilt = cells.join("|");
  if (rebuilt !== line) {
    modified = true;
    changed.push([name, prevStatus || "(empty)", derived]);
  }
  return rebuilt;
});

if (modified) fs.writeFileSync(roadmapPath, out.join(eol), "utf8");

console.log(`Roadmap status reconciled: ${changed.length} row(s) updated.`);
for (const [name, from, to] of changed) console.log(`  ${name}: ${from} → ${to}`);
if (!modified) console.log("  (already in sync)");
