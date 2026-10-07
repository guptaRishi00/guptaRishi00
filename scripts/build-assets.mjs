// Generates the Minecraft-themed SVGs for the profile README.
// Run from this folder:  bun build-assets.mjs   (writes ../assets/*.svg)
//
// Everything sits on a pixel grid so spacing stays consistent:
//   world textures = 3px per texel (one block = 48px)
//   UI chrome      = 4px per pixel
//   text           = Monocraft (OFL), 9 font pixels per em, size 18 = 2px pixels
// Text is converted to paths, so nothing depends on fonts being installed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets");
mkdirSync(out, { recursive: true });

const loadFont = (file) => {
  const b = readFileSync(join(here, "fonts", file));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const regular = loadFont("Monocraft.ttf");
const bold = loadFont("Monocraft-Bold.ttf");

const W = 880; // every block shares this width
const C = {
  white: "#FFFFFF",
  shadow: "#3F3F3F",
  yellow: "#FFFF55",
  yellowShadow: "#3F3F15",
  green: "#55FF55",
  greenShadow: "#153F15",
  purple: "#FF55FF",
  purpleShadow: "#3F153F",
  gray: "#AAAAAA",
  grayShadow: "#2A2A2A",
  guiLabel: "#404040",
};

// ---------- helpers ----------

// Deterministic RNG so every build produces identical textures.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// A 16x16 texture as rows of hex colours (null = transparent) -> <g> of rects.
function texture(grid, x, y, px) {
  let s = "";
  grid.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      const c = row[i];
      let run = 1;
      while (i + run < row.length && row[i + run] === c) run++;
      if (c) s += `<rect x="${x + i * px}" y="${y + j * px}" width="${run * px}" height="${px}" fill="${c}"/>`;
      i += run;
    }
  });
  return s;
}

const dirtPalette = ["#866043", "#79553A", "#6B4A32", "#9B7653", "#866043", "#866043"];
const grassPalette = ["#6AAA40", "#5B9A34", "#79C05A", "#5DA130"];

function dirtTile(seed) {
  const r = rng(seed);
  return Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => pick(r, dirtPalette)));
}

function grassSideTile(seed) {
  const r = rng(seed);
  const t = dirtTile(seed + 99);
  for (let i = 0; i < 16; i++) {
    const depth = 3 + (r() < 0.45 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let j = 0; j < depth; j++) t[j][i] = pick(r, grassPalette);
  }
  return t;
}

function logTile(seed) {
  const r = rng(seed);
  const cols = ["#6B5130", "#5A4325", "#886A3E", "#6B5130", "#4C391F"];
  const stripe = Array.from({ length: 16 }, () => pick(r, cols));
  return Array.from({ length: 16 }, () => stripe.map((c) => (r() < 0.12 ? pick(r, cols) : c)));
}

function leavesTile(seed) {
  const r = rng(seed);
  const cols = ["#3E7A1E", "#4A9024", "#2F5E17", "#57A52D", "#3E7A1E"];
  return Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, () => (r() < 0.07 ? "#1F3F0F" : pick(r, cols)))
  );
}

// Text -> SVG path. Shadow = one font pixel down-right, like Minecraft's chat text.
function text(str, { x, y, size = 18, fill = C.white, shadow = C.shadow, anchor = "start", font = regular }) {
  const width = font.getAdvanceWidth(str, size);
  const fx = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const px = size / 9;
  const d = (dx) => font.getPath(str, fx + dx, y + dx, size).toPathData(2);
  return (shadow ? `<path d="${d(px)}" fill="${shadow}"/>` : "") + `<path d="${d(0)}" fill="${fill}"/>`;
}

// Multi-colour line: [[str, fill, shadow], ...]
function richText(parts, { x, y, size = 18 }) {
  let cx = x;
  let s = "";
  for (const [str, fill, shadow] of parts) {
    s += text(str, { x: cx, y, size, fill, shadow });
    cx += regular.getAdvanceWidth(str, size);
  }
  return s;
}

const svg = (h, body, style = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" shape-rendering="crispEdges">` +
  (style ? `<style>${style}@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>` : "") +
  body +
  `</svg>`;

// Darkened dirt, the backdrop of every Minecraft menu screen.
function menuBackdrop(h, id) {
  const tile = dirtTile(7).map((row) => row.map((c) => shade(c, 0.28)));
  return (
    `<defs><pattern id="${id}" width="64" height="64" patternUnits="userSpaceOnUse">${texture(tile, 0, 0, 4)}</pattern></defs>` +
    `<rect width="${W}" height="${h}" fill="url(#${id})"/>`
  );
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

// Texture tiles are defined once and placed with <use>, which keeps file sizes small.
function tileSet(px) {
  const defs = [];
  const seen = new Set();
  return {
    use(id, grid, x, y) {
      if (!seen.has(id)) {
        seen.add(id);
        defs.push(`<g id="${id}">${texture(grid(), 0, 0, px)}</g>`);
      }
      return `<use href="#${id}" x="${x}" y="${y}"/>`;
    },
    defs: () => `<defs>${defs.join("")}</defs>`,
  };
}

// ---------- banner ----------

function banner() {
  const H = 400;
  const B = 48; // block size
  const px = 3;
  let body = "";

  // stepped sky
  const sky = ["#6E9BF5", "#78A5F7", "#83AFF8", "#8FB9FA", "#9CC3FB", "#AACDFD"];
  const band = Math.ceil((H - 2 * B) / sky.length);
  sky.forEach((c, i) => (body += `<rect y="${i * band}" width="${W}" height="${band + 1}" fill="${c}"/>`));

  // square sun
  body += `<rect x="736" y="44" width="64" height="64" fill="#FFF3A0"/><rect x="748" y="56" width="40" height="40" fill="#FFFFE6"/>`;

  // drifting blocky clouds (two copies side by side so the loop is seamless)
  const cloud = (x, y, w) =>
    `<rect x="${x}" y="${y}" width="${w}" height="24" fill="#FFFFFF"/>` +
    `<rect x="${x + 24}" y="${y - 12}" width="${w - 60}" height="12" fill="#FFFFFF"/>` +
    `<rect x="${x}" y="${y + 24}" width="${w}" height="6" fill="#DCE6F5"/>`;
  const clouds = cloud(180, 40, 144) + cloud(420, 24, 120) + cloud(600, 52, 96);
  body += `<g class="clouds">${clouds}<g transform="translate(${W} 0)">${clouds}</g></g>`;

  // terrain: column heights in blocks
  const tiles = tileSet(px);
  let world = "";
  const heights = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3];
  heights.forEach((h, i) => {
    for (let k = 0; k < h; k++) {
      const y = H - (k + 1) * B;
      world +=
        k === h - 1
          ? tiles.use(`g${i % 3}`, () => grassSideTile(100 + (i % 3)), i * B, y)
          : tiles.use(`d${(i + k) % 3}`, () => dirtTile(200 + ((i + k) % 3)), i * B, y);
    }
  });

  // oak tree on the left hill: two logs, a 3-wide canopy two blocks deep, one block on top
  const ground = H - 3 * B;
  world += tiles.use("log", () => logTile(5), B, ground - B) + tiles.use("log", () => logTile(5), B, ground - 2 * B);
  for (const [col, lvl] of [[0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4], [1, 5]]) {
    world += tiles.use(`l${(col + lvl) % 2}`, () => leavesTile(40 + ((col + lvl) % 2)), col * B, ground - lvl * B);
  }
  // flowers and tall grass on the low ground (sprites drawn bottom-aligned on the grass)
  const plant = (rows, palette, x) => {
    const grid = rows.map((r) => [...r].map((ch) => palette[ch] ?? null));
    return texture(grid, x, H - 2 * B - rows.length * px, px);
  };
  const poppy = [".rr.", "rRRr", ".rr.", "..g.", ".gg.", "..gg", "..g."];
  const dandelion = [".yy.", "yYYy", ".yy.", "..g.", "gg..", ".gg.", "..g."];
  const tuft = ["g...g", ".g.g.", ".g.gg", "gg.g.", ".ggg."];
  const flora = { r: "#C1272D", R: "#E8434A", y: "#E8C21C", Y: "#FFF07A", g: "#4E8A23" };
  for (const [kind, x] of [[tuft, 200], [poppy, 264], [tuft, 372], [dandelion, 468], [tuft, 540], [poppy, 612], [tuft, 690]]) {
    world += plant(kind, flora, x);
  }
  body += tiles.defs() + world;

  // title: black outline, dark extrusion, stone-textured face (like the game logo)
  const title = "RISHI GUPTA";
  const size = 72; // 8px font pixels
  const fp = size / 9;
  const ty = 156;
  const path = (dx, dy) => bold.getPath(title, W / 2 - bold.getAdvanceWidth(title, size) / 2 + dx, ty + dy, size).toPathData(2);
  const stone = rng(11);
  const stoneCols = ["#D6D6D6", "#C4C4C4", "#B4B4B4", "#E4E4E4", "#C4C4C4"];
  const stoneGrid = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => pick(stone, stoneCols)));
  body += `<defs><pattern id="stone" width="64" height="64" patternUnits="userSpaceOnUse">${texture(stoneGrid, 0, 0, 4)}</pattern></defs>`;
  for (const dx of [-fp, 0, fp]) for (const dy of [-fp, 0, fp, 2 * fp, 3 * fp]) body += `<path d="${path(dx, dy)}" fill="#111111"/>`;
  body += `<path d="${path(0, 2 * fp)}" fill="#3C3C3C"/><path d="${path(0, fp)}" fill="#5E5E5E"/>`;
  body += `<path d="${path(0, 0)}" fill="url(#stone)"/>`;
  body += text("FULL-STACK DEVELOPER", { x: W / 2, y: 232, size: 27, anchor: "middle" });

  // pulsing splash text, tucked under the end of the title like the game's
  body +=
    `<g transform="translate(742 206) rotate(-16)"><g class="splash">` +
    text("Also try Rust!", { x: 0, y: 6, size: 18, fill: C.yellow, shadow: C.yellowShadow, anchor: "middle" }) +
    `</g></g>`;

  const style =
    `.clouds{animation:drift 120s linear infinite}` +
    `@keyframes drift{to{transform:translateX(-${W}px)}}` +
    `.splash{transform-box:fill-box;transform-origin:center;animation:pulse .9s ease-in-out infinite alternate}` +
    `@keyframes pulse{from{transform:scale(1)}to{transform:scale(1.08)}}`;
  return svg(H, body, style);
}

// ---------- about (chat log) ----------

function aboutBlock(top) {
  const lines = [
    [["Rishi joined the game", C.yellow, C.yellowShadow]],
    [["<Rishi> ", C.white, C.shadow], ["Hey! I'm a full-stack developer.", C.white, C.shadow]],
    [["<Rishi> ", C.white, C.shadow], ["I build scalable apps and fast web experiences.", C.white, C.shadow]],
    [["<Rishi> ", C.white, C.shadow], ["I speak fluent React and broken English.", C.white, C.shadow]],
    [["<Rishi> ", C.white, C.shadow], ["MERN = Mostly Editing Random Node modules.", C.white, C.shadow]],
    [["<Rishi> ", C.white, C.shadow], ["Off-duty I generate photorealistic AI images.", C.white, C.shadow]],
    [["Rishi has made the advancement ", C.white, C.shadow], ["[Bug Slayer]", C.green, C.greenShadow]],
    [["Rishi has completed the challenge ", C.white, C.shadow], ["[Flawless Logic]", C.purple, C.purpleShadow]],
  ];
  const pad = 32;
  const titleH = 32;
  const t = top;
  const lineH = 36;
  const chatTop = t + titleH + 24;
  const chatH = lines.length * lineH + 16;
  const inputTop = chatTop + chatH + 8;
  const bottom = inputTop + 44;

  let body = text("About", { x: W / 2, y: t + 22, size: 27, anchor: "middle" });
  body += `<rect x="${pad}" y="${chatTop}" width="${W - 2 * pad}" height="${chatH}" fill="#000000" fill-opacity="0.55"/>`;
  lines.forEach((parts, i) => {
    body += richText(parts, { x: pad + 16, y: chatTop + 34 + i * lineH, size: 18 });
  });
  // chat input with a blinking cursor
  body += `<rect x="${pad}" y="${inputTop}" width="${W - 2 * pad}" height="44" fill="#000000" fill-opacity="0.7"/>`;
  body += text("/msg Rishi ", { x: pad + 16, y: inputTop + 29, size: 18 });
  const cursorX = pad + 16 + regular.getAdvanceWidth("/msg Rishi ", 18);
  body += `<g class="caret">${text("_", { x: cursorX, y: inputTop + 29, size: 18 })}</g>`;

  return { body, bottom };
}

// ---------- inventory (tech stack) ----------

const iconDir = join(here, "node_modules", "devicon", "icons");
const iconFile = {
  react: "react/react-original.svg",
  nextjs: "nextjs/nextjs-original.svg",
  typescript: "typescript/typescript-original.svg",
  javascript: "javascript/javascript-original.svg",
  tailwind: "tailwindcss/tailwindcss-original.svg",
  vite: "vitejs/vitejs-original.svg",
  node: "nodejs/nodejs-original.svg",
  express: "express/express-original.svg",
  bun: "bun/bun-original.svg",
  mongodb: "mongodb/mongodb-original.svg",
  postgres: "postgresql/postgresql-original.svg",
  prisma: "prisma/prisma-original.svg",
  redis: "redis/redis-original.svg",
  rust: "rust/rust-original.svg",
  tauri: "tauri/tauri-original.svg",
  python: "python/python-original.svg",
  opencv: "opencv/opencv-original.svg",
  powershell: "powershell/powershell-original.svg",
  vercel: "vercel/vercel-original.svg",
  aws: "amazonwebservices/amazonwebservices-original-wordmark.svg",
  azure: "azure/azure-original.svg",
  git: "git/git-original.svg",
  github: "github/github-original.svg",
  postman: "postman/postman-original.svg",
  photoshop: "photoshop/photoshop-original.svg",
};

// Rasterise a logo to 16x16 and redraw it as hard pixels: a Minecraft item sprite.
function sprite(name, x, y, px) {
  const src = readFileSync(join(iconDir, iconFile[name]), "utf8");
  const r = new Resvg(src, { fitTo: { mode: "width", value: 16 } }).render();
  const { width, height, pixels } = r; // premultiplied RGBA
  const oy = Math.floor((16 - height) / 2);
  const ox = Math.floor((16 - width) / 2);
  const grid = Array.from({ length: 16 }, () => Array(16).fill(null));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4;
      const a = pixels[o + 3];
      if (a < 110) continue;
      const un = (v) => Math.min(255, Math.round((v * 255) / a));
      const hex = (v) => un(v).toString(16).padStart(2, "0");
      grid[j + oy][i + ox] = `#${hex(pixels[o])}${hex(pixels[o + 1])}${hex(pixels[o + 2])}`;
    }
  }
  return texture(grid, x, y, px);
}

function inventoryBlock(top) {
  const rows = [
    ["Frontend", ["react", "nextjs", "typescript", "javascript", "tailwind", "vite"]],
    ["Backend", ["node", "express", "bun", "mongodb", "postgres", "prisma", "redis"]],
    ["Systems", ["rust", "tauri", "python", "opencv", "powershell"]],
    ["Tools", ["vercel", "aws", "azure", "git", "github", "postman", "photoshop"]],
  ];
  const P = 4;
  const slot = 64;
  const cols = 9;
  const labelW = 168;
  const inner = 28; // panel padding
  const gridW = cols * slot;
  const panelW = inner * 2 + labelW + gridW;
  const panelX = (W - panelW) / 2;
  const titleH = 32;
  const rowGap = 16;
  const panelTop = top;
  const gridTop = panelTop + inner + titleH + 12;
  const panelH = inner * 2 + titleH + 12 + rows.length * slot + (rows.length - 1) * rowGap;
  let body = "";

  // GUI panel: black outline, white top-left bevel, grey bottom-right bevel
  const x0 = panelX, y0 = panelTop, w = panelW, h = panelH;
  body += `<rect x="${x0 + P}" y="${y0}" width="${w - 2 * P}" height="${h}" fill="#000"/>`;
  body += `<rect x="${x0}" y="${y0 + P}" width="${w}" height="${h - 2 * P}" fill="#000"/>`;
  body += `<rect x="${x0 + P}" y="${y0 + P}" width="${w - 2 * P}" height="${h - 2 * P}" fill="#FFFFFF"/>`;
  body += `<rect x="${x0 + 2 * P}" y="${y0 + 2 * P}" width="${w - 3 * P}" height="${h - 3 * P}" fill="#555555"/>`;
  body += `<rect x="${x0 + 2 * P}" y="${y0 + 2 * P}" width="${w - 4 * P}" height="${h - 4 * P}" fill="#C6C6C6"/>`;

  body += text("Inventory", { x: x0 + inner, y: panelTop + inner + 22, size: 27, fill: C.guiLabel, shadow: null });

  rows.forEach(([label, items], r) => {
    const y = gridTop + r * (slot + rowGap);
    body += text(label, { x: x0 + inner, y: y + slot / 2 + 8, size: 18, fill: C.guiLabel, shadow: null });
    for (let c = 0; c < cols; c++) {
      const sx = x0 + inner + labelW + c * slot;
      body += `<rect x="${sx}" y="${y}" width="${slot}" height="${slot}" fill="#373737"/>`;
      body += `<rect x="${sx + P}" y="${y + P}" width="${slot - P}" height="${slot - P}" fill="#FFFFFF"/>`;
      body += `<rect x="${sx + P}" y="${y + P}" width="${slot - 2 * P}" height="${slot - 2 * P}" fill="#8B8B8B"/>`;
      if (items[c]) body += sprite(items[c], sx + 8, y + 8, 3);
    }
  });

  return { body, bottom: panelTop + panelH };
}

// About, Inventory and the Statistics heading share one image so the dirt
// backdrop is continuous. Every gap is a multiple of 8: 32 outside, 48 between.
function menu() {
  const pad = 32;
  const gap = 48;
  const a = aboutBlock(pad);
  const inv = inventoryBlock(a.bottom + gap);
  const statsTop = inv.bottom + gap;
  const H = statsTop + 32 + pad;
  const body =
    menuBackdrop(H, "dirt") +
    a.body +
    inv.body +
    text("Statistics", { x: W / 2, y: statsTop + 22, size: 27, anchor: "middle" });
  const style = `.caret{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}`;
  return svg(H, body, style);
}

// Minecraft menu button, sized to sit three across the README column.
function button(label) {
  const w = 280, h = 56, P = 4;
  const body =
    `<rect width="${w}" height="${h}" fill="#000"/>` +
    `<rect x="${P}" y="${P}" width="${w - 2 * P}" height="${h - 2 * P}" fill="#6F6F6F"/>` +
    `<rect x="${P}" y="${P}" width="${w - 2 * P}" height="${P}" fill="#A8A8A8"/>` +
    `<rect x="${P}" y="${P}" width="${P}" height="${h - 2 * P}" fill="#A8A8A8"/>` +
    `<rect x="${P}" y="${h - 3 * P}" width="${w - 2 * P}" height="${2 * P}" fill="#4A4A4A"/>` +
    text(label, { x: w / 2, y: 36, size: 18, anchor: "middle" });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
}

// ---------- write ----------

const files = {
  "banner.svg": banner(),
  "menu.svg": menu(),
  "btn-linkedin.svg": button("LinkedIn"),
  "btn-email.svg": button("Email"),
  "btn-instagram.svg": button("Instagram"),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(out, name), content);
  console.log(`${name.padEnd(18)} ${(content.length / 1024).toFixed(1)} KB`);
}

// PNG previews for eyeballing (resvg renders the first animation frame).
if (process.argv.includes("--preview")) {
  const prev = join(here, "preview");
  mkdirSync(prev, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const png = new Resvg(content).render().asPng();
    writeFileSync(join(prev, name.replace(".svg", ".png")), png);
  }
}
