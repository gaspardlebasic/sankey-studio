// Décline build/icon.png (1024) en build/icon.icns (macOS) et build/icon.ico (Windows).
// Prérequis : sips + iconutil (macOS). Le .ico est empaqueté à la main : le format
// Vista+ n'est qu'un en-tête suivi de PNG bruts, aucune dépendance nécessaire.
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SRC = "build/icon.png";
const tmp = mkdtempSync(join(tmpdir(), "sankey-icons-"));

function resize(size, out) {
  execFileSync("sips", ["-z", String(size), String(size), SRC, "--out", out], { stdio: "pipe" });
}

/* ---------------------------------------------------------------- .icns */
const iconset = join(tmp, "icon.iconset");
mkdirSync(iconset);
// Une taille par appel : sous zsh, une boucle sur « $paire » ne se découpe pas en mots.
const icnsSizes = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"]
];
for (const [size, name] of icnsSizes) resize(size, join(iconset, name));
execFileSync("iconutil", ["-c", "icns", iconset, "-o", "build/icon.icns"], { stdio: "inherit" });

/* ----------------------------------------------------------------- .ico */
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = icoSizes.map(size => {
  const f = join(tmp, `ico-${size}.png`);
  resize(size, f);
  return { size, data: readFileSync(f) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // réservé
header.writeUInt16LE(1, 2);            // type 1 = icône
header.writeUInt16LE(images.length, 4);

const entries = Buffer.alloc(16 * images.length);
let offset = header.length + entries.length;
images.forEach((img, i) => {
  const p = i * 16;
  entries.writeUInt8(img.size >= 256 ? 0 : img.size, p);     // 0 signifie 256
  entries.writeUInt8(img.size >= 256 ? 0 : img.size, p + 1);
  entries.writeUInt8(0, p + 2);        // palette
  entries.writeUInt8(0, p + 3);        // réservé
  entries.writeUInt16LE(1, p + 4);     // plans
  entries.writeUInt16LE(32, p + 6);    // bits par pixel
  entries.writeUInt32LE(img.data.length, p + 8);
  entries.writeUInt32LE(offset, p + 12);
  offset += img.data.length;
});
writeFileSync("build/icon.ico", Buffer.concat([header, entries, ...images.map(i => i.data)]));

rmSync(tmp, { recursive: true, force: true });
console.log("build/icon.icns et build/icon.ico régénérés");
