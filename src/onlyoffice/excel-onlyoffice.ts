/**
 * Adaptateur ONLYOFFICE — lecture/écriture du diagramme dans le classeur ouvert
 * sous ONLYOFFICE Spreadsheet Editor via window.Asc.plugin.callCommand.
 *
 * Le schéma — colonnes, ordre de tri, types, préservation des formules —
 * provient de src/shared/modele-excel.js (source de vérité unique).
 */

import {
  NODE_COLS, LINK_COLS, LINK_COL_BIO, LINK_COLS_ECRITES, NODE_START, LINK_START,
  buildModelRows, toInt, toNum, typeDepuisTexte, partBioDepuisTexte
} from "../shared/modele-excel.js";
import type { FormulePreservee, Modele } from "../shared/modele-excel.js";
import type {
  DonneesExcel, NoeudExcel, LienExcel, OptionsEcriture,
  ResultatEcriture, Initialisation, ResultatAjoutColonnes, ColonnesManquantes
} from "./types.js";

const FEUILLE_DEFAUT = "Diagramme";
const CLE_APPARENCE = "sankey-studio-apparence";

/** Exécute une commande dans le bac à sable Document Server ONLYOFFICE. */
export function executerCommande<T>(commande: () => any, donnees?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (
      typeof window === "undefined" ||
      !window.Asc ||
      !window.Asc.plugin ||
      typeof window.Asc.plugin.callCommand !== "function"
    ) {
      reject(new Error("Environnement ONLYOFFICE Plugin introuvable (window.Asc.plugin.callCommand manquant)"));
      return;
    }

    if (donnees !== undefined) {
      window.Asc.scope = window.Asc.scope || {};
      window.Asc.scope.__sankey_data = donnees;
    }

    try {
      window.Asc.plugin.callCommand(
        commande,
        false, // ne ferme pas la fenêtre du plugin
        false, // pas d'animation
        (ret: any) => {
          resolve(ret);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/** Nom du classeur ou de la feuille active sous ONLYOFFICE. */
export async function nomDuClasseur(): Promise<string> {
  try {
    const res = await executerCommande<string>(function () {
      // @ts-ignore
      var ws = Api.GetActiveSheet();
      // @ts-ignore
      return ws ? ws.GetName() : "Classeur ONLYOFFICE";
    });
    return res || "Classeur ONLYOFFICE";
  } catch {
    return "Classeur ONLYOFFICE";
  }
}

/**
 * Lecture des réglages d'apparence enregistrés dans le classeur via ApiCustomProperties.
 */
export async function lireApparence(): Promise<string | null> {
  try {
    return await executerCommande<string | null>(function () {
      // @ts-ignore
      var props = Api.GetCustomProperties();
      if (!props) return null;
      // @ts-ignore
      var val = props.Get("sankey-studio-apparence");
      return typeof val === "string" && val ? val : null;
    });
  } catch {
    return null;
  }
}

/**
 * Écriture des réglages d'apparence dans le classeur via ApiCustomProperties.
 */
export async function ecrireApparence(json: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await executerCommande(function () {
      // @ts-ignore
      var payload = Asc.scope.__sankey_data;
      // @ts-ignore
      var props = Api.GetCustomProperties();
      if (props && typeof props.Add === "function") {
        props.Add("sankey-studio-apparence", payload);
      }
    }, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Vérifie si le diagramme (tableaux ou en-têtes Nœuds et Liens) est présent.
 */
export async function diagrammePresent(nomFeuille?: string): Promise<boolean> {
  try {
    const res = await executerCommande<boolean>(function () {
      // @ts-ignore
      var feuilleCible = Asc.scope.__sankey_data || "Diagramme";
      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === feuilleCible) {
          ws = sheets[i];
          break;
        }
      }
      if (!ws) {
        // @ts-ignore
        ws = Api.GetActiveSheet();
      }
      if (!ws) return false;

      // 1. Vérification par ListObjects si disponible
      if (typeof ws.GetListObjects === "function") {
        var tables = ws.GetListObjects();
        var aNoeuds = false;
        var aLiens = false;
        for (var t = 0; t < tables.length; t++) {
          var header = tables[t].GetHeaderRowRange();
          var vals = header ? header.GetValue() : null;
          if (vals) {
            var row = Array.isArray(vals[0]) ? vals[0] : vals;
            for (var c = 0; c < row.length; c++) {
              if (String(row[c]).trim() === "Noeud") aNoeuds = true;
              if (String(row[c]).trim() === "Origine") aLiens = true;
            }
          }
        }
        if (aNoeuds && aLiens) return true;
      }

      // 2. Vérification par inspection des premières lignes (A1:Z5)
      for (var r = 0; r < 5; r++) {
        var foundNoeud = false;
        var foundOrigine = false;
        for (var col = 0; col < 26; col++) {
          var val = ws.GetRangeByNumber(r, col).GetValue();
          var s = String(val || "").trim();
          if (s === "Noeud") foundNoeud = true;
          if (s === "Origine") foundOrigine = true;
        }
        if (foundNoeud && foundOrigine) return true;
      }

      return false;
    }, nomFeuille || FEUILLE_DEFAUT);

    return !!res;
  } catch {
    return false;
  }
}

/**
 * Initialise un classeur vierge avec la feuille « Diagramme » et les deux tableaux.
 */
export async function initialiserClasseur(nomFeuille?: string): Promise<Initialisation> {
  const feuilleVoulue = nomFeuille || FEUILLE_DEFAUT;
  try {
    const res = await executerCommande<Initialisation>(function () {
      // @ts-ignore
      var data = Asc.scope.__sankey_data;
      var fNom = data.nomFeuille;
      var nodeCols = data.nodeCols;
      var linkCols = data.linkCols;

      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === fNom) {
          ws = sheets[i];
          break;
        }
      }

      function colLettre(idx: number) {
        var temp = idx;
        var lettre = "";
        while (temp >= 0) {
          lettre = String.fromCharCode((temp % 26) + 65) + lettre;
          temp = Math.floor(temp / 26) - 1;
        }
        return lettre;
      }

      if (ws) {
        // La feuille existe déjà : vérifions si elle est non vide
        var valA1 = ws.GetRangeByNumber(0, 0).GetValue();
        if (valA1 !== "" && valA1 !== null && valA1 !== undefined) {
          return { ok: false, statut: "feuille_non_vide", message: "La feuille « " + fNom + " » contient déjà des données." };
        }
      } else {
        // @ts-ignore
        ws = Api.AddWorksheet(fNom);
      }

      if (!ws) {
        return { ok: false, statut: "erreur", message: "Impossible de créer la feuille « " + fNom + " »." };
      }

      // Écriture des en-têtes des nœuds en A1
      for (var c = 0; c < nodeCols.length; c++) {
        ws.GetRangeByNumber(0, c).SetValue(nodeCols[c]);
        // Une ligne vide sous l'en-tête
        ws.GetRangeByNumber(1, c).SetValue("");
      }

      // Écriture des en-têtes des liens en K1 (colonne 10)
      var colLien0 = 10;
      for (var cl = 0; cl < linkCols.length; cl++) {
        ws.GetRangeByNumber(0, colLien0 + cl).SetValue(linkCols[cl]);
        ws.GetRangeByNumber(1, colLien0 + cl).SetValue("");
      }

      // Si AddListObject est disponible, créer les tables formatées
      if (typeof ws.AddListObject === "function") {
        try {
          var refNoeuds = "A1:" + colLettre(nodeCols.length - 1) + "2";
          var refLiens = colLettre(colLien0) + "1:" + colLettre(colLien0 + linkCols.length - 1) + "2";
          var rangeN = ws.GetRange(refNoeuds);
          var rangeL = ws.GetRange(refLiens);
          if (rangeN) ws.AddListObject(rangeN, "Noeuds");
          if (rangeL) ws.AddListObject(rangeL, "Liens");
        } catch (e) {
          // Si AddListObject échoue, les en-têtes et cellules restent posés
        }
      }

      return { ok: true, statut: "cree" };
    }, {
      nomFeuille: feuilleVoulue,
      nodeCols: NODE_COLS,
      linkCols: LINK_COLS
    });

    return res || { ok: false, statut: "erreur" };
  } catch (e) {
    return { ok: false, statut: "erreur", message: (e as Error).message };
  }
}

/**
 * Lit le diagramme (nœuds, liens, formules) depuis ONLYOFFICE.
 */
export async function lireDiagramme(nomFeuille?: string): Promise<DonneesExcel | null> {
  try {
    const raw = await executerCommande<any>(function () {
      // @ts-ignore
      var cible = Asc.scope.__sankey_data || "Diagramme";
      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === cible) {
          ws = sheets[i];
          break;
        }
      }
      if (!ws) {
        // @ts-ignore
        ws = Api.GetActiveSheet();
      }
      if (!ws) return null;

      function colLettre(idx: number) {
        var temp = idx;
        var lettre = "";
        while (temp >= 0) {
          lettre = String.fromCharCode((temp % 26) + 65) + lettre;
          temp = Math.floor(temp / 26) - 1;
        }
        return lettre;
      }

      var tables = (typeof ws.GetListObjects === "function") ? ws.GetListObjects() : [];
      var tNoeuds = null;
      var tLiens = null;

      for (var t = 0; t < tables.length; t++) {
        var hRange = tables[t].GetHeaderRowRange();
        var hVals = hRange ? hRange.GetValue() : null;
        if (hVals) {
          var rVals = Array.isArray(hVals[0]) ? hVals[0] : hVals;
          for (var c = 0; c < rVals.length; c++) {
            var colName = String(rVals[c] || "").trim();
            if (colName === "Noeud") tNoeuds = tables[t];
            if (colName === "Origine") tLiens = tables[t];
          }
        }
      }

      // Si les tables structurées existent, lire leur plage
      if (tNoeuds && tLiens) {
        var rRangeN = tNoeuds.GetRange();
        var rRangeL = tLiens.GetRange();
        var valsN = rRangeN ? rRangeN.GetValue() : [];
        var valsL = rRangeL ? rRangeL.GetValue() : [];
        var formL = rRangeL ? rRangeL.GetFormula() : [];

        return JSON.stringify({
          feuille: ws.GetName(),
          noeuds: { valeurs: valsN },
          liens: { valeurs: valsL, formules: formL }
        });
      }

      // Repli : lecture directe par détection des en-têtes dans les 100 premières lignes et 30 colonnes
      var rowNoeudIdx = -1;
      var colNoeudIdx = -1;
      var rowLienIdx = -1;
      var colLienIdx = -1;

      for (var r = 0; r < 20; r++) {
        for (var c = 0; c < 30; c++) {
          var val = String(ws.GetRangeByNumber(r, c).GetValue() || "").trim();
          if (val === "Noeud" && rowNoeudIdx === -1) {
            rowNoeudIdx = r;
            colNoeudIdx = c;
          }
          if (val === "Origine" && rowLienIdx === -1) {
            rowLienIdx = r;
            colLienIdx = c;
          }
        }
      }

      if (rowNoeudIdx === -1 || rowLienIdx === -1) return null;

      // Lecture des colonnes des nœuds (à partir de colNoeudIdx vers la gauche pour Filière ou jusqu'à vide)
      var startColN = colNoeudIdx > 0 ? colNoeudIdx - 1 : 0;
      var endColN = startColN;
      while (String(ws.GetRangeByNumber(rowNoeudIdx, endColN).GetValue() || "").trim() !== "" && endColN < 30) {
        endColN++;
      }
      endColN--;

      // Trouver la dernière ligne des nœuds
      var endRowN = rowNoeudIdx + 1;
      while (endRowN < 500) {
        var cellV = ws.GetRangeByNumber(endRowN, colNoeudIdx).GetValue();
        if (cellV === "" || cellV === null || cellV === undefined) break;
        endRowN++;
      }
      endRowN--;

      var refN = colLettre(startColN) + (rowNoeudIdx + 1) + ":" + colLettre(endColN) + (Math.max(endRowN, rowNoeudIdx + 1) + 1);
      var rangeN = ws.GetRange(refN);
      var valsN = rangeN ? rangeN.GetValue() : [];

      // Liens
      var startColL = colLienIdx > 0 ? colLienIdx - 1 : colLienIdx;
      var endColL = startColL;
      while (String(ws.GetRangeByNumber(rowLienIdx, endColL).GetValue() || "").trim() !== "" && endColL < 40) {
        endColL++;
      }
      endColL--;

      var endRowL = rowLienIdx + 1;
      while (endRowL < 1000) {
        var cellOrigine = ws.GetRangeByNumber(endRowL, colLienIdx).GetValue();
        if (cellOrigine === "" || cellOrigine === null || cellOrigine === undefined) break;
        endRowL++;
      }
      endRowL--;

      var refL = colLettre(startColL) + (rowLienIdx + 1) + ":" + colLettre(endColL) + (Math.max(endRowL, rowLienIdx + 1) + 1);
      var rangeL = ws.GetRange(refL);
      var valsL = rangeL ? rangeL.GetValue() : [];
      var formL = rangeL ? rangeL.GetFormula() : [];

      return JSON.stringify({
        feuille: ws.GetName(),
        noeuds: { valeurs: valsN },
        liens: { valeurs: valsL, formules: formL }
      });
    }, nomFeuille || FEUILLE_DEFAUT);

    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || !parsed.noeuds || !parsed.liens) return null;

    return decoderDonnees(parsed);
  } catch {
    return null;
  }
}

function decoderDonnees(brut: { feuille: string; noeuds: { valeurs: any[][] }; liens: { valeurs: any[][]; formules?: any[][] } }): DonneesExcel {
  const valsN = brut.noeuds.valeurs || [];
  const valsL = brut.liens.valeurs || [];
  const formL = brut.liens.formules || [];

  const entetesN = (valsN[0] || []).map(c => String(c || "").trim());
  const entetesL = (valsL[0] || []).map(c => String(c || "").trim());

  const idxN = new Map<string, number>();
  entetesN.forEach((h, i) => { if (h && !idxN.has(h)) idxN.set(h, i); });

  const idxL = new Map<string, number>();
  entetesL.forEach((h, i) => { if (h && !idxL.has(h)) idxL.set(h, i); });

  const hasLane = idxN.has("Couloir");
  const hasKind = idxN.has("Type");
  const hasBio = idxL.has(LINK_COL_BIO);

  const colonnesManquantes: ColonnesManquantes = {
    noeuds: ["Couloir", "Type"].filter(c => !idxN.has(c)),
    liens: []
  };

  const getCellN = (row: any[], col: string): any => {
    const i = idxN.get(col);
    return i !== undefined && i < row.length ? row[i] : null;
  };
  const getCellL = (row: any[], col: string): any => {
    const i = idxL.get(col);
    return i !== undefined && i < row.length ? row[i] : null;
  };

  const nodes: NoeudExcel[] = [];
  for (let r = 1; r < valsN.length; r++) {
    const row = valsN[r];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === "")) continue;

    const name = String(getCellN(row, "Noeud") || "").trim();
    if (!name) continue;

    const rawId = getCellN(row, "ID");
    const id = rawId !== null && rawId !== undefined && String(rawId).trim() !== "" ? String(rawId).trim() : null;
    const column = toInt(getCellN(row, "Numéro de colonne d'affichage"), 1);
    const title = String(getCellN(row, "Intitulé de la colonne d'affichage") || "").trim();
    const order = toInt(getCellN(row, "Ordre vertical d'affichage"), 0);
    const lane = toInt(getCellN(row, "Couloir"), 1);
    const kind = typeDepuisTexte(getCellN(row, "Type"));
    const filiere = String(getCellN(row, "Filière") || "").trim();
    const rawColor = getCellN(row, "Couleur");
    const color = rawColor && String(rawColor).trim() ? String(rawColor).trim() : null;

    nodes.push({ id, name, column, title, order, lane, kind, filiere, color });
  }

  const links: LienExcel[] = [];
  for (let r = 1; r < valsL.length; r++) {
    const row = valsL[r];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === "")) continue;

    const sourceName = String(getCellL(row, "Origine") || "").trim();
    const targetName = String(getCellL(row, "Destination") || "").trim();
    if (!sourceName && !targetName) continue;

    const rawSrcId = getCellL(row, "ID origine");
    const sourceId = rawSrcId !== null && rawSrcId !== undefined && String(rawSrcId).trim() !== "" ? String(rawSrcId).trim() : null;
    const rawTgtId = getCellL(row, "ID destination");
    const targetId = rawTgtId !== null && rawTgtId !== undefined && String(rawTgtId).trim() !== "" ? String(rawTgtId).trim() : null;

    const value = toNum(getCellL(row, "Valeur du flux"), 0);
    const unit = String(getCellL(row, "Unité") || "").trim();
    const bio = partBioDepuisTexte(getCellL(row, LINK_COL_BIO));

    links.push({ sourceId, targetId, sourceName, targetName, value, unit, bio });
  }

  return {
    nodes,
    links,
    hasLane,
    hasKind,
    hasBio,
    sheetName: brut.feuille,
    colonnesManquantes
  };
}

/**
 * Récupère les formules existantes dans la colonne "Valeur du flux" pour les préserver.
 */
function extraireFormulesExistantes(valsL: any[][], formL: any[][], idxL: Map<string, number>): Map<string, FormulePreservee> {
  const map = new Map<string, FormulePreservee>();
  const iVal = idxL.get("Valeur du flux");
  const iSrcId = idxL.get("ID origine");
  const iTgtId = idxL.get("ID destination");
  const iSrc = idxL.get("Origine");
  const iTgt = idxL.get("Destination");

  if (iVal === undefined) return map;

  for (let r = 1; r < valsL.length; r++) {
    const rowF = formL && r < formL.length ? formL[r] : null;
    const formuleCell = rowF && iVal < rowF.length ? rowF[iVal] : null;
    if (!formuleCell || typeof formuleCell !== "string" || !formuleCell.startsWith("=")) continue;

    const formuleSansEgal = formuleCell.slice(1);
    const fp: FormulePreservee = { f: formuleSansEgal, source: r };

    const rowV = valsL[r];
    const srcId = iSrcId !== undefined && iSrcId < rowV.length ? String(rowV[iSrcId] || "").trim() : "";
    const tgtId = iTgtId !== undefined && iTgtId < rowV.length ? String(rowV[iTgtId] || "").trim() : "";
    if (srcId && tgtId) {
      map.set(`id:${srcId} ${tgtId}`, fp);
    }

    const srcName = iSrc !== undefined && iSrc < rowV.length ? String(rowV[iSrc] || "").trim() : "";
    const tgtName = iTgt !== undefined && iTgt < rowV.length ? String(rowV[iTgt] || "").trim() : "";
    if (srcName && tgtName) {
      map.set(`name:${srcName} ${tgtName}`, fp);
    }
  }

  return map;
}

/**
 * Écrit le diagramme dans ONLYOFFICE en préservant les formules et l'ordre des colonnes.
 */
export async function ecrireDiagramme(
  model: Modele,
  nomFeuille?: string,
  options?: OptionsEcriture
): Promise<ResultatEcriture> {
  try {
    // 1. D'abord lire les tableaux existants pour capter les formules
    const brut = await executerCommande<any>(function () {
      // @ts-ignore
      var cible = Asc.scope.__sankey_data || "Diagramme";
      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === cible) {
          ws = sheets[i];
          break;
        }
      }
      if (!ws) {
        // @ts-ignore
        ws = Api.GetActiveSheet();
      }
      if (!ws) return null;

      var tables = (typeof ws.GetListObjects === "function") ? ws.GetListObjects() : [];
      var tLiens = null;
      for (var t = 0; t < tables.length; t++) {
        var hRange = tables[t].GetHeaderRowRange();
        var hVals = hRange ? hRange.GetValue() : null;
        if (hVals) {
          var rVals = Array.isArray(hVals[0]) ? hVals[0] : hVals;
          for (var c = 0; c < rVals.length; c++) {
            if (String(rVals[c] || "").trim() === "Origine") tLiens = tables[t];
          }
        }
      }

      if (tLiens) {
        var rL = tLiens.GetRange();
        return JSON.stringify({
          valeurs: rL ? rL.GetValue() : [],
          formules: rL ? rL.GetFormula() : []
        });
      }
      return null;
    }, nomFeuille || FEUILLE_DEFAUT);

    const mapFormules = new Map<string, FormulePreservee>();
    if (brut) {
      const parsed = typeof brut === "string" ? JSON.parse(brut) : brut;
      const valsL = parsed.valeurs || [];
      const formL = parsed.formules || [];
      const entetesL = (valsL[0] || []).map((c: any) => String(c || "").trim());
      const idxL = new Map<string, number>();
      entetesL.forEach((h: string, i: number) => { if (h && !idxL.has(h)) idxL.set(h, i); });
      const extraites = extraireFormulesExistantes(valsL, formL, idxL);
      extraites.forEach((v, k) => mapFormules.set(k, v));
    }

    // 2. Préparer les lignes via buildModelRows
    const { nodeRows, linkRows } = buildModelRows(model, mapFormules);

    // 3. Écrire dans ONLYOFFICE
    const resEcriture = await executerCommande<ResultatEcriture>(function () {
      // @ts-ignore
      var payload = Asc.scope.__sankey_data;
      var fCible = payload.feuille;
      var nodeRowsData = payload.nodeRows;
      var linkRowsData = payload.linkRows;
      var nodeCols = payload.nodeCols;
      var linkCols = payload.linkCols;

      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === fCible) {
          ws = sheets[i];
          break;
        }
      }
      if (!ws) {
        // @ts-ignore
        ws = Api.GetActiveSheet();
      }
      if (!ws) return { ok: false, error: "Feuille introuvable" };

      function colLettre(idx: number) {
        var temp = idx;
        var lettre = "";
        while (temp >= 0) {
          lettre = String.fromCharCode((temp % 26) + 65) + lettre;
          temp = Math.floor(temp / 26) - 1;
        }
        return lettre;
      }

      var tables = (typeof ws.GetListObjects === "function") ? ws.GetListObjects() : [];
      var tNoeuds = null;
      var tLiens = null;

      for (var t = 0; t < tables.length; t++) {
        var hRange = tables[t].GetHeaderRowRange();
        var hVals = hRange ? hRange.GetValue() : null;
        if (hVals) {
          var rVals = Array.isArray(hVals[0]) ? hVals[0] : hVals;
          for (var c = 0; c < rVals.length; c++) {
            var nomCol = String(rVals[c] || "").trim();
            if (nomCol === "Noeud") tNoeuds = tables[t];
            if (nomCol === "Origine") tLiens = tables[t];
          }
        }
      }

      // Déterminer les colonnes et positions
      var startRowN = 0;
      var startColN = 0;
      var startRowL = 0;
      var startColL = 10;

      if (tNoeuds) {
        var rN = tNoeuds.GetRange();
        startRowN = rN.GetRow();
        startColN = rN.GetCol();
      } else {
        // Trouver la ligne d'en-tête "Noeud"
        for (var rn = 0; rn < 10; rn++) {
          for (var cn = 0; cn < 20; cn++) {
            if (String(ws.GetRangeByNumber(rn, cn).GetValue() || "").trim() === "Noeud") {
              startRowN = rn;
              startColN = cn > 0 ? cn - 1 : 0;
              break;
            }
          }
          if (startRowN > 0) break;
        }
      }

      if (tLiens) {
        var rL = tLiens.GetRange();
        startRowL = rL.GetRow();
        startColL = rL.GetCol();
      } else {
        for (var rl = 0; rl < 10; rl++) {
          for (var cl = 0; cl < 30; cl++) {
            if (String(ws.GetRangeByNumber(rl, cl).GetValue() || "").trim() === "Origine") {
              startRowL = rl;
              startColL = cl > 0 ? cl - 1 : cl;
              break;
            }
          }
          if (startRowL > 0) break;
        }
      }

      // 1. Écriture des Nœuds
      // Repérer l'ordre réel des en-têtes présents
      var entetesReelsN = [];
      for (var colN = 0; colN < 20; colN++) {
        var headerVal = String(ws.GetRangeByNumber(startRowN, startColN + colN).GetValue() || "").trim();
        if (!headerVal) break;
        entetesReelsN.push(headerVal);
      }
      if (entetesReelsN.length === 0) entetesReelsN = nodeCols;

      var nbLignesN = Math.max(nodeRowsData.length, 1);
      for (var rIdx = 0; rIdx < nbLignesN; rIdx++) {
        var rowObj = rIdx < nodeRowsData.length ? nodeRowsData[rIdx] : null;
        for (var hIdx = 0; hIdx < entetesReelsN.length; hIdx++) {
          var hName = entetesReelsN[hIdx];
          var cellTarget = ws.GetRangeByNumber(startRowN + 1 + rIdx, startColN + hIdx);
          var posDansModele = nodeCols.indexOf(hName);
          if (posDansModele >= 0 && rowObj) {
            var cellData = rowObj[posDansModele];
            if (cellData && cellData.t === "n") {
              cellTarget.SetValue(cellData.v);
            } else if (cellData && cellData.t === "s") {
              cellTarget.SetValue(cellData.v);
            } else {
              cellTarget.SetValue("");
            }
          } else if (!rowObj) {
            cellTarget.SetValue("");
          }
        }
      }

      // Nettoyer les anciennes lignes excédentaires sous le tableau des nœuds
      var maxLignesNettoyage = 200;
      for (var rOver = nbLignesN; rOver < nbLignesN + maxLignesNettoyage; rOver++) {
        var valCellCheck = ws.GetRangeByNumber(startRowN + 1 + rOver, startColN + 1).GetValue();
        if (valCellCheck === "" || valCellCheck === null || valCellCheck === undefined) break;
        for (var hIdx2 = 0; hIdx2 < entetesReelsN.length; hIdx2++) {
          ws.GetRangeByNumber(startRowN + 1 + rOver, startColN + hIdx2).SetValue("");
        }
      }

      // 2. Écriture des Liens
      var entetesReelsL = [];
      for (var colL = 0; colL < 20; colL++) {
        var headerValL = String(ws.GetRangeByNumber(startRowL, startColL + colL).GetValue() || "").trim();
        if (!headerValL) break;
        entetesReelsL.push(headerValL);
      }
      if (entetesReelsL.length === 0) entetesReelsL = linkCols;

      var nbLignesL = Math.max(linkRowsData.length, 1);
      for (var rIdxL = 0; rIdxL < nbLignesL; rIdxL++) {
        var rowObjL = rIdxL < linkRowsData.length ? linkRowsData[rIdxL] : null;
        for (var hIdxL = 0; hIdxL < entetesReelsL.length; hIdxL++) {
          var hNameL = entetesReelsL[hIdxL];
          // Ne jamais écraser la colonne "Part bio / durable" si elle est déjà dans le classeur
          if (hNameL === "Part bio / durable") continue;

          var cellTargetL = ws.GetRangeByNumber(startRowL + 1 + rIdxL, startColL + hIdxL);
          var posDansModeleL = linkCols.indexOf(hNameL);
          if (posDansModeleL >= 0 && rowObjL) {
            var cellDataL = rowObjL[posDansModeleL];
            if (cellDataL && cellDataL.t === "f" && cellDataL.f) {
              cellTargetL.SetFormula("=" + cellDataL.f);
            } else if (cellDataL && cellDataL.t === "n") {
              cellTargetL.SetValue(cellDataL.v);
            } else if (cellDataL && cellDataL.t === "s") {
              cellTargetL.SetValue(cellDataL.v);
            } else {
              cellTargetL.SetValue("");
            }
          } else if (!rowObjL) {
            cellTargetL.SetValue("");
          }
        }
      }

      // Nettoyer les lignes excédentaires sous le tableau des liens
      for (var rOverL = nbLignesL; rOverL < nbLignesL + maxLignesNettoyage; rOverL++) {
        var valLCheck = ws.GetRangeByNumber(startRowL + 1 + rOverL, startColL + 1).GetValue();
        if (valLCheck === "" || valLCheck === null || valLCheck === undefined) break;
        for (var hIdxL2 = 0; hIdxL2 < entetesReelsL.length; hIdxL2++) {
          if (entetesReelsL[hIdxL2] === "Part bio / durable") continue;
          ws.GetRangeByNumber(startRowL + 1 + rOverL, startColL + hIdxL2).SetValue("");
        }
      }

      return { ok: true };
    }, {
      feuille: nomFeuille || FEUILLE_DEFAUT,
      nodeRows,
      linkRows,
      nodeCols: NODE_COLS,
      linkCols: LINK_COLS_ECRITES
    });

    return {
      ok: resEcriture && resEcriture.ok,
      error: resEcriture && resEcriture.error
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Ajoute les colonnes manquantes ("Couloir", "Type") dans le tableau des nœuds.
 */
export async function ajouterColonnesManquantes(nomFeuille?: string): Promise<ResultatAjoutColonnes> {
  try {
    const res = await executerCommande<ResultatAjoutColonnes>(function () {
      // @ts-ignore
      var cible = Asc.scope.__sankey_data || "Diagramme";
      // @ts-ignore
      var sheets = Api.GetSheets();
      var ws = null;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].GetName() === cible) {
          ws = sheets[i];
          break;
        }
      }
      if (!ws) {
        // @ts-ignore
        ws = Api.GetActiveSheet();
      }
      if (!ws) return { ok: false, message: "Feuille introuvable" };

      var startRowN = 0;
      var startColN = 0;
      for (var rn = 0; rn < 10; rn++) {
        for (var cn = 0; cn < 20; cn++) {
          if (String(ws.GetRangeByNumber(rn, cn).GetValue() || "").trim() === "Noeud") {
            startRowN = rn;
            startColN = cn > 0 ? cn - 1 : 0;
            break;
          }
        }
        if (startRowN > 0) break;
      }

      var entetes = [];
      var lastCol = startColN;
      for (var c = 0; c < 20; c++) {
        var h = String(ws.GetRangeByNumber(startRowN, startColN + c).GetValue() || "").trim();
        if (!h) break;
        entetes.push(h);
        lastCol = startColN + c;
      }

      var ajoutees = [];
      if (entetes.indexOf("Couloir") === -1) {
        lastCol++;
        ws.GetRangeByNumber(startRowN, lastCol).SetValue("Couloir");
        ajoutees.push("Couloir");
      }
      if (entetes.indexOf("Type") === -1) {
        lastCol++;
        ws.GetRangeByNumber(startRowN, lastCol).SetValue("Type");
        ajoutees.push("Type");
      }

      return {
        ok: true,
        message: ajoutees.length > 0 ? ajoutees.join(", ") : "Aucune colonne à ajouter",
        colonnesAjoutees: { noeuds: ajoutees, liens: [] }
      };
    }, nomFeuille || FEUILLE_DEFAUT);

    return res || { ok: false, message: "Échec de l'ajout des colonnes" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
