"use strict";

// Écriture du diagramme dans un classeur Excel : un onglet, deux tableaux
// (« Noeuds » et « Liens ») côte à côte, mis en forme comme des tableaux Excel.
// - crée le classeur s'il n'existe pas ;
// - sinon met à jour le seul onglet géré, en préservant les autres onglets
//   (formules, graphiques…) grâce à une écriture ciblée du zip .xlsx.

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

// Verrou spécifique à CE classeur : Excel crée « ~$<nom> » à côté du fichier
// et le supprime à la fermeture. On ne se fie donc PAS à n'importe quel « ~$… ».
function isWorkbookLocked(filePath) {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const ext = path.extname(base);
    const files = fs.readdirSync(dir);
    if (files.includes("~$" + base)) return true;
    // Variante tronquée (noms longs) : même extension et suffixe correspondant.
    return files.some(
      f => f.startsWith("~$") && f !== "~$" && f.endsWith(ext) && base.endsWith(f.slice(2))
    );
  } catch (e) {
    return false;
  }
}

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_TABLE = "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";
const CT_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const REL_TABLE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
const REL_SHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

// « Couloir » puis « Type » sont ajoutés EN FIN de liste, et non à leur place
// logique après l'ordre vertical : les classeurs existants gardent ainsi leurs
// colonnes exactement où elles sont, et n'en gagnent qu'une à chaque fois.
//
// Le schéma du classeur — colonnes, ordre de tri, types, buildModelRows — vit
// dans src/shared/modele-excel.js : il est partagé avec le complément Office,
// qui écrit dans le classeur OUVERT. Une seule source de vérité, sinon les deux
// chemins d'écriture produiraient des classeurs différents.
const {
  NODE_COLS, LINK_COLS, NODE_START, GAP, LINK_START,
  toInt, toNum, couloirDe, TYPE_LABELS, typeDe, typeDepuisTexte,
  comparerTexte, comparerPlacement, filiereDuLien, buildModelRows
} = require("../shared/modele-excel.js");

/* ----------------------------- utilitaires ----------------------------- */

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}


function esc(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellText(ref, value, s) {
  return `<c r="${ref}"${sAttr(s)} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}
function cellNumber(ref, value, s) {
  return `<c r="${ref}"${sAttr(s)}><v>${value}</v></c>`;
}
function cellFormula(ref, formula, cached, s) {
  // Préserve une formule existante (sans le « = » initial) + valeur en cache.
  const v = cached === null || cached === undefined || isNaN(cached) ? 0 : cached;
  return `<c r="${ref}"${sAttr(s)}><f>${esc(formula)}</f><v>${v}</v></c>`;
}
function sAttr(s) {
  // Index de style de cellule préservé depuis le classeur existant.
  return s ? ` s="${s}"` : "";
}
function emitCell(ref, c, s) {
  if (c.t === "f") return cellFormula(ref, c.f, c.v, s);
  if (c.t === "n") return cellNumber(ref, c.v, s);
  return cellText(ref, c.v, s);
}


/**
 * Génère le XML de la feuille (sheetData + tableParts) et le XML des deux
 * tableaux. tableIds = [idNoeuds, idLiens] uniques dans le classeur.
 * preserve (facultatif) : mise en forme relue du classeur existant —
 * { styleByRef, rowAttrsByNum, colsXml, sheetFormatPr, nodeStyleInfo, linkStyleInfo }.
 * L'app n'impose ainsi PAS sa mise en forme : celle de l'utilisateur est gardée.
 */
function buildSheetAndTables(model, tableIds, tableNames, formulaMap, preserve) {
  const { nodeRows, linkRows } = buildModelRows(model, formulaMap);
  const nNodes = nodeRows.length;
  const nLinks = linkRows.length;
  const dataRows = Math.max(nNodes, nLinks);
  const lastRow = dataRows + 1; // + entête
  const styleOf = ref => (preserve && preserve.styleByRef && preserve.styleByRef[ref]) || null;
  const rowAttrs = num =>
    (preserve && preserve.rowAttrsByNum && preserve.rowAttrsByNum[num]) || "";

  // Entêtes (ligne 1)
  const cells = [];
  const headerCells = [];
  NODE_COLS.forEach((h, i) => {
    const ref = colLetter(NODE_START + i) + "1";
    headerCells.push(cellText(ref, h, styleOf(ref)));
  });
  LINK_COLS.forEach((h, i) => {
    const ref = colLetter(LINK_START + i) + "1";
    headerCells.push(cellText(ref, h, styleOf(ref)));
  });
  cells.push(`<row r="1"${rowAttrs(1)}>${headerCells.join("")}</row>`);

  // Lignes de données
  for (let r = 0; r < dataRows; r++) {
    const rowNum = r + 2;
    const parts = [];
    if (r < nNodes) {
      nodeRows[r].forEach((c, i) => {
        const ref = colLetter(NODE_START + i) + rowNum;
        if (c.t !== "f" && (c.v === "" || c.v === null || c.v === undefined)) return;
        parts.push(emitCell(ref, c, styleOf(ref)));
      });
    }
    if (r < nLinks) {
      linkRows[r].forEach((c, i) => {
        const ref = colLetter(LINK_START + i) + rowNum;
        if (c.t !== "f" && (c.v === "" || c.v === null || c.v === undefined)) return;
        parts.push(emitCell(ref, c, styleOf(ref)));
      });
    }
    cells.push(`<row r="${rowNum}"${rowAttrs(rowNum)}>${parts.join("")}</row>`);
  }

  const lastCol = colLetter(LINK_START + LINK_COLS.length - 1);
  const dimension = `A1:${lastCol}${lastRow}`;

  // Mise en forme : réutilise celle du classeur (colonnes, hauteurs par défaut)
  const colsXml =
    (preserve && preserve.colsXml) ||
    `<cols>` +
      `<col min="1" max="1" width="14" customWidth="1"/>` +
      `<col min="2" max="2" width="26" customWidth="1"/>` +
      `<col min="3" max="5" width="20" customWidth="1"/>` +
      `<col min="6" max="8" width="14" customWidth="1"/>` +
      `<col min="${LINK_START}" max="${LINK_START}" width="14" customWidth="1"/>` +
      `<col min="${LINK_START + 1}" max="${LINK_START + 2}" width="26" customWidth="1"/>` +
      `<col min="${LINK_START + 3}" max="${LINK_START + 6}" width="14" customWidth="1"/>` +
      `</cols>`;
  const sheetFormatPr =
    (preserve && preserve.sheetFormatPr) || `<sheetFormatPr defaultRowHeight="15"/>`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    sheetFormatPr +
    colsXml +
    `<sheetData>${cells.join("")}</sheetData>` +
    `<tableParts count="2"><tablePart r:id="rId1"/><tablePart r:id="rId2"/></tableParts>` +
    `</worksheet>`;

  const nodeRef = `A1:${colLetter(NODE_START + NODE_COLS.length - 1)}${lastRowFor(nNodes)}`;
  const linkRef = `${colLetter(LINK_START)}1:${colLetter(LINK_START + LINK_COLS.length - 1)}${lastRowFor(nLinks)}`;

  const tableNodes = tableXml(
    tableIds[0], tableNames[0], nodeRef, NODE_COLS,
    preserve ? preserve.nodeStyleInfo : null
  );
  const tableLinks = tableXml(
    tableIds[1], tableNames[1], linkRef, LINK_COLS,
    preserve ? preserve.linkStyleInfo : null
  );

  return { sheetXml, tableNodes, tableLinks };
}

function lastRowFor(count) {
  // Un tableau Excel nécessite au moins une ligne de données -> min 2.
  return Math.max(2, count + 1);
}

function tableXml(id, name, ref, cols, styleInfo) {
  const colsXml = cols
    .map((c, i) => `<tableColumn id="${i + 1}" name="${esc(c)}"/>`)
    .join("");
  // styleInfo : « <tableStyleInfo …/> » préservé du tableau existant,
  // "" si l'utilisateur avait retiré le style, null/undefined -> style par défaut.
  const style =
    styleInfo === "" ? "" :
    styleInfo ||
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<table xmlns="${NS_MAIN}" id="${id}" name="${esc(name)}" displayName="${esc(name)}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${cols.length}">${colsXml}</tableColumns>` +
    style +
    `</table>`
  );
}

/* ------------------------- nouveau classeur --------------------------- */

function buildNewWorkbook(model, sheetName) {
  const zip = new JSZip();
  const { sheetXml, tableNodes, tableLinks } = buildSheetAndTables(
    model,
    [1, 2],
    ["Noeuds", "Liens"]
  );

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT_SHEET}"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/tables/table1.xml" ContentType="${CT_TABLE}"/>` +
      `<Override PartName="/xl/tables/table2.xml" ContentType="${CT_TABLE}"/>` +
      `</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_SHEET}" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );

  zip.file("xl/styles.xml", minimalStyles());
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_TABLE}" Target="../tables/table1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_TABLE}" Target="../tables/table2.xml"/>` +
      `</Relationships>`
  );
  zip.file("xl/tables/table1.xml", tableNodes);
  zip.file("xl/tables/table2.xml", tableLinks);

  return zip;
}

function minimalStyles() {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/* ------------------------ classeur existant --------------------------- */

async function updateExistingWorkbook(buf, model, sheetName) {
  const zip = await JSZip.loadAsync(buf);

  // Formules « Valeur du flux » à préserver (calculs liés au reste du classeur).
  const formulaMap = await extractValueFormulas(zip, sheetName);

  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const wbRelsPath = "xl/_rels/workbook.xml.rels";
  let wbRels = zip.file(wbRelsPath) ? await zip.file(wbRelsPath).async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG_REL}"></Relationships>`;
  const ctPath = "[Content_Types].xml";
  let ct = await zip.file(ctPath).async("string");

  const sheetMatch = new RegExp(
    `<sheet[^>]*name="${escapeRegex(sheetName)}"[^>]*/>`
  ).exec(wbXml);

  // Numéro de fichier de feuille libre
  let maxSheetFile = 0;
  zip.forEach((path) => {
    const m = path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/);
    if (m) maxSheetFile = Math.max(maxSheetFile, parseInt(m[1], 10));
  });

  let sheetFileName; // ex: sheet3.xml
  // Mise en forme à préserver (celle que l'utilisateur a appliquée dans Excel)
  const preserve = {
    styleByRef: null, rowAttrsByNum: null, colsXml: null,
    sheetFormatPr: null, nodeStyleInfo: null, linkStyleInfo: null
  };

  if (sheetMatch) {
    // --- Remplacement de l'onglet géré existant ---
    const rid = /r:id="([^"]+)"/.exec(sheetMatch[0]);
    const relId = rid ? rid[1] : null;
    const relTarget = relId ? findRelTarget(wbRels, relId) : null;
    const target = relTarget
      ? relTarget.replace(/^\/?xl\//, "")
      : `worksheets/sheet${maxSheetFile}.xml`;
    sheetFileName = target.split("/").pop();

    // Relit la mise en forme actuelle de l'onglet (styles de cellules,
    // hauteurs de lignes, largeurs de colonnes) pour la ré-émettre telle quelle.
    const sheetPath = `xl/worksheets/${sheetFileName}`;
    if (zip.file(sheetPath)) {
      const oldXml = await zip.file(sheetPath).async("string");
      // Retire les attributs à préfixe (x14ac:…, xr:…) : leurs espaces de noms
      // ne sont pas déclarés dans la feuille régénérée -> XML invalide sinon.
      const stripNs = s =>
        s ? s.replace(/\s+[A-Za-z0-9]+:[A-Za-z0-9._-]+="[^"]*"/g, "") : s;
      preserve.colsXml = stripNs((/<cols>[\s\S]*?<\/cols>/.exec(oldXml) || [null])[0]);
      preserve.sheetFormatPr = stripNs((/<sheetFormatPr[^>]*\/>/.exec(oldXml) || [null])[0]);
      preserve.styleByRef = {};
      const cRe = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
      let cm;
      while ((cm = cRe.exec(oldXml))) {
        const ref = (/r="([^"]+)"/.exec(cm[1]) || [])[1];
        const s = (/\bs="(\d+)"/.exec(cm[1]) || [])[1];
        if (ref && s) preserve.styleByRef[ref] = s;
      }
      preserve.rowAttrsByNum = {};
      const rowRe = /<row\b([^>]*?)\/?>/g;
      let rm;
      while ((rm = rowRe.exec(oldXml))) {
        const num = (/\br="(\d+)"/.exec(rm[1]) || [])[1];
        if (!num) continue;
        // On ne garde que les attributs de mise en forme (pas r/spans, recalculés)
        const kept = [...rm[1].matchAll(/\b(ht|customHeight|s|customFormat|thickTop|thickBot)="[^"]*"/g)]
          .map(x => x[0]).join(" ");
        if (kept) preserve.rowAttrsByNum[num] = " " + kept;
      }
    }

    // Supprime les anciens tableaux liés à cette feuille, en gardant leur
    // <tableStyleInfo> (style choisi par l'utilisateur dans Excel).
    const relsPath = `xl/worksheets/_rels/${sheetFileName}.rels`;
    if (zip.file(relsPath)) {
      const oldRels = await zip.file(relsPath).async("string");
      const oldTables = [...oldRels.matchAll(/Target="([^"]*tables\/table\d+\.xml)"/g)];
      for (const m of oldTables) {
        const tp = m[1].startsWith("/")
          ? m[1].replace(/^\//, "")
          : m[1].replace(/^\.\.\//, "xl/");
        if (zip.file(tp)) {
          const tx = await zip.file(tp).async("string");
          const info = (/<tableStyleInfo[^>]*\/>/.exec(tx) || [null])[0];
          if (/name="Noeud"/.test(tx)) preserve.nodeStyleInfo = info || "";
          else if (/name="Origine"/.test(tx)) preserve.linkStyleInfo = info || "";
        }
        zip.remove(tp);
        ct = ct.replace(
          new RegExp(`<Override PartName="/${escapeRegex(tp)}"[^>]*/>`),
          ""
        );
      }
    }
  } else {
    // --- Ajout d'un nouvel onglet ---
    sheetFileName = `sheet${maxSheetFile + 1}.xml`;

    // sheetId et rId libres
    const sheetIds = [...wbXml.matchAll(/sheetId="(\d+)"/g)].map(m => +m[1]);
    const newSheetId = (sheetIds.length ? Math.max(...sheetIds) : 0) + 1;
    const ridNums = [...wbRels.matchAll(/Id="rId(\d+)"/g)].map(m => +m[1]);
    const newRid = "rId" + ((ridNums.length ? Math.max(...ridNums) : 0) + 1);

    // Ajoute la relation feuille
    wbRels = wbRels.replace(
      "</Relationships>",
      `<Relationship Id="${newRid}" Type="${REL_SHEET}" Target="worksheets/${sheetFileName}"/></Relationships>`
    );
    // Ajoute la feuille au workbook
    const sheetEntry = `<sheet name="${esc(sheetName)}" sheetId="${newSheetId}" r:id="${newRid}"/>`;
    const newWb = wbXml.replace(/(<sheets>)([\s\S]*?)(<\/sheets>)/, `$1$2${sheetEntry}$3`);
    zip.file("xl/workbook.xml", newWb);
    zip.file(wbRelsPath, wbRels);
    // Content-type de la feuille
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/xl/worksheets/${sheetFileName}" ContentType="${CT_SHEET}"/></Types>`
    );
  }

  // IDs et noms de tableaux calculés APRÈS suppression des anciens tableaux
  // de l'onglet géré (pour réutiliser « Noeuds »/« Liens »).
  let maxTableId = 0;
  const existingNames = [];
  for (const p of Object.keys(zip.files)) {
    const m = p.match(/^xl\/tables\/table(\d+)\.xml$/);
    if (m) {
      maxTableId = Math.max(maxTableId, parseInt(m[1], 10));
      const x = await zip.file(p).async("string");
      const nm = /displayName="([^"]+)"/.exec(x);
      if (nm) existingNames.push(nm[1]);
    }
  }
  const tableIds = [maxTableId + 1, maxTableId + 2];
  const tableNames = [
    uniqueName("Noeuds", existingNames),
    uniqueName("Liens", existingNames)
  ];

  const { sheetXml, tableNodes, tableLinks } = buildSheetAndTables(
    model,
    tableIds,
    tableNames,
    formulaMap,
    preserve
  );

  const tableFile1 = `table${tableIds[0]}.xml`;
  const tableFile2 = `table${tableIds[1]}.xml`;

  zip.file(`xl/worksheets/${sheetFileName}`, sheetXml);
  zip.file(
    `xl/worksheets/_rels/${sheetFileName}.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_TABLE}" Target="../tables/${tableFile1}"/>` +
      `<Relationship Id="rId2" Type="${REL_TABLE}" Target="../tables/${tableFile2}"/>` +
      `</Relationships>`
  );
  zip.file(`xl/tables/${tableFile1}`, tableNodes);
  zip.file(`xl/tables/${tableFile2}`, tableLinks);

  // Content-types des tableaux
  if (!ct.includes(`/xl/tables/${tableFile1}`)) {
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/xl/tables/${tableFile1}" ContentType="${CT_TABLE}"/>` +
        `<Override PartName="/xl/tables/${tableFile2}" ContentType="${CT_TABLE}"/></Types>`
    );
  }
  zip.file(ctPath, ct);

  return zip;
}

function uniqueName(base, taken) {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(base + i)) i++;
  return base + i;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cible d'une relation par Id, quel que soit l'ordre des attributs. */
function findRelTarget(relsXml, id) {
  const tagRe = /<Relationship\b[^>]*?\/?>/g;
  let m;
  while ((m = tagRe.exec(relsXml))) {
    const tag = m[0];
    if (new RegExp(`Id="${escapeRegex(id)}"`).test(tag)) {
      const t = /Target="([^"]+)"/.exec(tag);
      return t ? t[1] : null;
    }
  }
  return null;
}

/* ------------------------------- API ---------------------------------- */

/* ------------------------------ LECTURE ------------------------------- */

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: colNumber(m[1]), row: parseInt(m[2], 10) };
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1]));
    out.push(texts.join(""));
  }
  return out;
}

/** Grille { "A1": value, ... } à partir du XML d'une feuille. */
function parseSheetCells(sheetXml, sharedStrings) {
  const cells = {};
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRe.exec(sheetXml))) {
    const attrs = m[1];
    const inner = m[2] || "";
    const refM = /r="([^"]+)"/.exec(attrs);
    if (!refM) continue;
    const ref = refM[1];
    const t = (/t="([^"]+)"/.exec(attrs) || [])[1];
    let val = "";
    if (t === "inlineStr") {
      val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join("");
    } else if (t === "s") {
      const idx = parseInt((/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1], 10);
      val = sharedStrings[idx] != null ? sharedStrings[idx] : "";
    } else {
      const raw = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      if (raw === undefined) val = "";
      else if (t === "str" || t === "b") val = decodeXml(raw);
      else {
        const num = Number(raw);
        val = isNaN(num) ? decodeXml(raw) : num;
      }
    }
    cells[ref] = val;
  }
  return cells;
}

/** Résout le chemin xl/worksheets/sheetN.xml de l'onglet nommé sheetName. */
async function resolveSheetPath(zip, sheetName) {
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const sheetTag = new RegExp(`<sheet[^>]*name="${escapeRegex(sheetName)}"[^>]*/>`).exec(wbXml);
  if (!sheetTag) return null;
  const rid = (/r:id="([^"]+)"/.exec(sheetTag[0]) || [])[1];
  if (!rid) return null;
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const target = findRelTarget(rels, rid);
  if (!target) return null;
  return "xl/" + target.replace(/^\/?xl\//, "");
}

/** Lit les tableaux référencés par une feuille : [{name, ref, columns:[..]}] */
async function readSheetTables(zip, sheetPath) {
  const sheetFile = sheetPath.split("/").pop();
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const tables = [];
  if (!zip.file(relsPath)) return tables;
  const rels = await zip.file(relsPath).async("string");
  const targets = [...rels.matchAll(/Target="([^"]*tables\/table\d+\.xml)"/g)].map(m => m[1]);
  for (const tgt of targets) {
    // Cible relative (../tables/..) ou absolue (/xl/tables/..) -> xl/tables/..
    const p = tgt.startsWith("/")
      ? tgt.replace(/^\//, "")
      : "xl/" + tgt.replace(/^\.\.\//, "");
    if (!zip.file(p)) continue;
    const tx = await zip.file(p).async("string");
    const ref = (/ref="([^"]+)"/.exec(tx) || [])[1];
    const columns = [...tx.matchAll(/<tableColumn[^>]*name="([^"]*)"/g)].map(m => decodeXml(m[1]));
    tables.push({ ref, columns });
  }
  return tables;
}

/** Formules par référence de cellule (celles qui contiennent <f>…</f>). */
function parseCellFormulas(sheetXml) {
  const out = {};
  const re = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(sheetXml))) {
    const ref = (/r="([^"]+)"/.exec(m[1]) || [])[1];
    if (!ref) continue;
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2]);
    if (f) out[ref] = decodeXml(f[1]);
  }
  return out;
}

/**
 * Récupère les formules « Valeur du flux » du classeur existant, indexées par
 * identité de lien (id:src\0tgt et name:origine\0destination).
 */
async function extractValueFormulas(zip, sheetName) {
  const map = new Map();
  const sheetPath = await resolveSheetPath(zip, sheetName);
  if (!sheetPath || !zip.file(sheetPath)) return map;
  const ssXml = zip.file("xl/sharedStrings.xml")
    ? await zip.file("xl/sharedStrings.xml").async("string")
    : "";
  const shared = parseSharedStrings(ssXml);
  const sheetXml = await zip.file(sheetPath).async("string");
  const cells = parseSheetCells(sheetXml, shared);
  const formulaByRef = parseCellFormulas(sheetXml);
  const tables = await readSheetTables(zip, sheetPath);
  const linksT = tables.find(t => t.columns.includes("Origine"));
  if (!linksT) return map;

  const [a, b] = linksT.ref.split(":");
  const start = parseRef(a);
  const end = parseRef(b);
  const off = name => linksT.columns.indexOf(name);
  const valOff = off("Valeur du flux");
  if (valOff < 0) return map;
  const oNameOff = off("Origine"), dNameOff = off("Destination");
  const oIdOff = off("ID origine"), dIdOff = off("ID destination");

  for (let r = start.row + 1; r <= end.row; r++) {
    const formula = formulaByRef[colLetter(start.col + valOff) + r];
    if (!formula) continue;
    const oName = String(cells[colLetter(start.col + oNameOff) + r] || "");
    const dName = String(cells[colLetter(start.col + dNameOff) + r] || "");
    const oId = oIdOff >= 0 ? String(cells[colLetter(start.col + oIdOff) + r] || "") : "";
    const dId = dIdOff >= 0 ? String(cells[colLetter(start.col + dIdOff) + r] || "") : "";
    if (oId && dId) map.set("id:" + oId + " " + dId, formula);
    if (oName && dName) map.set("name:" + oName + " " + dName, formula);
  }
  return map;
}

/** Extrait les lignes d'un tableau sous forme d'objets {header: value}. */
function extractTable(cells, table) {
  const [a, b] = table.ref.split(":");
  const start = parseRef(a);
  const end = parseRef(b);
  const rows = [];
  for (let r = start.row + 1; r <= end.row; r++) {
    const obj = {};
    let any = false;
    table.columns.forEach((h, i) => {
      const ref = colLetter(start.col + i) + r;
      const v = cells[ref];
      obj[h] = v === undefined ? "" : v;
      if (v !== undefined && v !== "") any = true;
    });
    if (any) rows.push(obj);
  }
  return rows;
}

/**
 * Lit le diagramme depuis un classeur : renvoie { nodes, links } ou null si
 * l'onglet géré est absent.
 */
async function readDiagram(filePath, sheetName) {
  sheetName = sheetName || "Diagramme";
  if (!fs.existsSync(filePath)) return null;
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const sheetPath = await resolveSheetPath(zip, sheetName);
  if (!sheetPath || !zip.file(sheetPath)) return null;

  const ssXml = zip.file("xl/sharedStrings.xml")
    ? await zip.file("xl/sharedStrings.xml").async("string")
    : "";
  const sharedStrings = parseSharedStrings(ssXml);
  const sheetXml = await zip.file(sheetPath).async("string");
  const cells = parseSheetCells(sheetXml, sharedStrings);
  const tables = await readSheetTables(zip, sheetPath);

  const nodesT = tables.find(t => t.columns.includes("Noeud"));
  const linksT = tables.find(t => t.columns.includes("Origine"));

  const nodes = [];
  if (nodesT) {
    for (const r of extractTable(cells, nodesT)) {
      const name = String(r["Noeud"] || "").trim();
      if (!name) continue;
      nodes.push({
        id: String(r["ID"] || "").trim() || null,
        name,
        column: toInt(r["Numéro de colonne d'affichage"], 1),
        title: String(r["Intitulé de la colonne d'affichage"] || ""),
        order: toInt(r["Ordre vertical d'affichage"], 0),
        lane: Math.max(1, toInt(r["Couloir"], 1)),
        kind: typeDepuisTexte(r["Type"]),
        filiere: String(r["Filière"] || ""),
        color: String(r["Couleur"] || "").trim() || null
      });
    }
  }
  const links = [];
  if (linksT) {
    for (const r of extractTable(cells, linksT)) {
      const s = String(r["Origine"] || "").trim();
      const t = String(r["Destination"] || "").trim();
      if (!s || !t) continue;
      links.push({
        sourceId: String(r["ID origine"] || "").trim() || null,
        targetId: String(r["ID destination"] || "").trim() || null,
        sourceName: s,
        targetName: t,
        value: toNum(r["Valeur du flux"], 0),
        unit: String(r["Unité"] || "")
      });
    }
  }
  // Un classeur écrit avant l'arrivée des couloirs (ou des types) n'a pas la
  // colonne : l'app doit alors GARDER ce qu'elle connaît au lieu de tout
  // remettre au défaut.
  const aCouloir = !!(nodesT && nodesT.columns.includes("Couloir"));
  const aType = !!(nodesT && nodesT.columns.includes("Type"));
  return { sheetName, nodes, links, hasLane: aCouloir, hasKind: aType };
}


/* ------------------------------------------------------------------ */

async function writeDiagram(filePath, model, sheetName) {
  sheetName = sheetName || "Diagramme";
  let zip;
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    zip = await updateExistingWorkbook(buf, model, sheetName);
  } else {
    zip = buildNewWorkbook(model, sheetName);
  }
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE"
  });
  fs.writeFileSync(filePath, out);
  return { path: filePath, sheetName };
}


/**
 * Lit les formules de la colonne « Valeur du flux » d'un classeur sur disque.
 * Renvoie un objet simple (sérialisable via IPC) indexé comme extractValueFormulas :
 * « id:<origine> <destination> » et « name:<Origine> <Destination> ».
 */
async function readValueFormulas(filePath, sheetName) {
  if (!fs.existsSync(filePath)) return {};
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const map = await extractValueFormulas(zip, sheetName || "Diagramme");
  const out = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

module.exports = {
  writeDiagram, readDiagram, isWorkbookLocked, buildModelRows, NODE_COLS, LINK_COLS,
  extractValueFormulas, readValueFormulas, typeDe, typeDepuisTexte
};
