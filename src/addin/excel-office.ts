/**
 * Adaptateur Office.js — lecture/écriture du diagramme dans le classeur OUVERT.
 *
 * Équivalent de src/main/excel.js (fichier fermé) et src/main/excel-live.js
 * (pilotage d'Excel), mais depuis l'intérieur d'Excel. Le schéma — colonnes,
 * ordre de tri, types, préservation des formules — n'est PAS redéfini ici : il
 * vient de src/shared/modele-excel.js, partagé avec l'écriture du .xlsx.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 * 1. **Le coût est le nombre d'allers-retours, pas le nombre de cellules.**
 *    Mesuré en phase 0 : 2 001 cellules écrites en 12 ms avec un seul sync,
 *    contre ~1 350 ms pour 500 cellules par évènements Apple. On empile donc
 *    les affectations et on ne synchronise qu'aux points marqués « sync ».
 *
 * 2. **Les tableaux se retrouvent par leurs EN-TÊTES, jamais par leur adresse**,
 *    et les colonnes s'écrivent **une par une, par nom d'en-tête**. Un classeur
 *    dont les colonnes sont dans un autre ordre reste donc lisible ET
 *    inscriptible, et une colonne que l'utilisatrice aurait ajoutée dans le
 *    tableau n'est pas écrasée. Affecter le corps entier d'un coup coûterait le
 *    même prix mais supposerait l'ordre de NODE_COLS.
 */

import {
  NODE_COLS, LINK_COLS, buildModelRows, toInt, toNum, typeDepuisTexte
} from "../shared/modele-excel.js";
import type { Cellule, Modele, NodeKind } from "../shared/modele-excel.js";

/* ------------------------------ contrat ------------------------------ */
/* Ces formes sont consommées telles quelles par le renderer (editor.ts).  */

export interface NoeudExcel {
  id: string | null; name: string; column: number; title: string;
  order: number; lane: number; kind: NodeKind; filiere: string; color: string | null;
}
export interface LienExcel {
  sourceId: string | null; targetId: string | null;
  sourceName: string; targetName: string;
  value: number; unit: string;
}
export interface DonneesExcel {
  nodes: NoeudExcel[];
  links: LienExcel[];
  /** Le classeur porte-t-il la colonne « Couloir » ? Sinon l'app garde les siennes. */
  hasLane?: boolean;
  /** Idem pour « Type ». */
  hasKind?: boolean;
  sheetName?: string;
}

export interface OptionsEcriture {
  /** Demander à Excel d'enregistrer après l'écriture. Réservé à un « App → Excel » explicite. */
  save?: boolean;
}

export type Formules = Record<string, string>;

const FEUILLE_DEFAUT = "Diagramme";
/** Un tableau Excel ne peut pas avoir zéro ligne : on en garde une, vide. */
const MIN_LIGNES = 1;

/* --------------------------- repérage --------------------------- */

interface TableauTrouve {
  table: Excel.Table;
  entetes: string[];
  /** Position de chaque en-tête, par nom. Un classeur peut les avoir dans un autre ordre. */
  index: Map<string, number>;
}
interface Tableaux {
  noeuds: TableauTrouve | null;
  liens: TableauTrouve | null;
  feuille: string;
}

function indexer(entetes: string[]): Map<string, number> {
  const m = new Map<string, number>();
  entetes.forEach((h, i) => { if (h && !m.has(h)) m.set(h, i); });
  return m;
}

/**
 * Retrouve les deux tableaux par leurs en-têtes — « Noeud » pour les nœuds,
 * « Origine » pour les liens. Coûte un premier sync pour la liste des tableaux,
 * un second pour leurs lignes d'en-tête.
 *
 * **Les deux tableaux doivent être sur la MÊME feuille**, et cette feuille est
 * d'abord celle qu'on demande (« Diagramme » par défaut). C'est la règle de
 * src/main/excel.js, qui ne lit jamais que les tableaux d'une seule feuille —
 * et ce n'était pas celle d'ici : le premier essai dans Excel a repéré comme
 * tableau des liens un `flux_lait` sans rapport, posé sur une autre feuille,
 * parce qu'il portait lui aussi une colonne « Origine » et venait en premier.
 * 32 liens lus au lieu de 129 — et, à la première écriture, un tableau de
 * l'utilisatrice écrasé.
 *
 * La feuille demandée est donc prioritaire ; à défaut, on prend une feuille qui
 * porte LES DEUX tableaux, jamais deux moitiés cueillies sur deux feuilles.
 */
async function trouverTableaux(
  context: Excel.RequestContext, nomFeuille?: string
): Promise<Tableaux> {
  const tables = context.workbook.tables;
  tables.load("items/name, items/worksheet/name");
  await context.sync();                                            // sync 1

  const entetes = tables.items.map(t => {
    const r = t.getHeaderRowRange();
    r.load("values");
    return r;
  });
  await context.sync();                                            // sync 2

  interface Candidat extends TableauTrouve { feuille: string; }
  const candidats: Candidat[] = tables.items.map((t, i) => {
    const brut: unknown[] = (entetes[i].values && entetes[i].values[0]) || [];
    const cols = brut.map(c => String(c === null || c === undefined ? "" : c).trim());
    return { table: t, entetes: cols, index: indexer(cols), feuille: t.worksheet.name };
  });

  const surLaFeuille = (f: string): Tableaux => {
    const dedans = candidats.filter(c => c.feuille === f);
    return {
      noeuds: dedans.find(c => c.entetes.indexOf("Noeud") >= 0) || null,
      liens: dedans.find(c => c.entetes.indexOf("Origine") >= 0) || null,
      feuille: f
    };
  };

  const feuilles: string[] = [];
  for (const c of candidats) if (feuilles.indexOf(c.feuille) < 0) feuilles.push(c.feuille);

  // Plus le rang est bas, meilleure est la feuille. À rang égal, l'ordre du
  // classeur tranche.
  const demandee = nomFeuille || FEUILLE_DEFAUT;
  const rang = (t: Tableaux): number => {
    if (t.feuille === demandee && (t.noeuds || t.liens)) return 0;
    if (t.noeuds && t.liens) return 1;
    if (t.noeuds) return 2;                 // « Noeud » est l'en-tête la plus sûre
    if (t.liens) return 3;
    return 9;
  };

  let meilleur: Tableaux = { noeuds: null, liens: null, feuille: "" };
  let meilleurRang = 9;
  for (const f of feuilles) {
    const t = surLaFeuille(f);
    const r = rang(t);
    if (r < meilleurRang) { meilleur = t; meilleurRang = r; }
  }
  return meilleur;
}

/** Corps du tableau, en-tête comprise : getRange() existe même sans ligne de données. */
function corpsAvecEntete(t: TableauTrouve): Excel.Range {
  return t.table.getRange();
}

/** Découpe la réponse de getRange() en lignes de données (l'en-tête est la ligne 0). */
function lignesDonnees(valeurs: unknown[][]): unknown[][] {
  return valeurs && valeurs.length > 1 ? valeurs.slice(1) : [];
}

/** Une ligne est vide si toutes ses cellules le sont — même règle qu'extractTable(). */
function ligneVide(ligne: unknown[]): boolean {
  return ligne.every(v => v === null || v === undefined || String(v) === "");
}

function texte(v: unknown): string {
  return String(v === null || v === undefined ? "" : v);
}

/* ------------------------------ LECTURE ------------------------------ */

/**
 * Lit le diagramme dans le classeur ouvert. Rend la même forme que
 * readDiagram() de src/main/excel.js — mêmes replis, mêmes valeurs par défaut.
 */
export async function lireDiagramme(nomFeuille?: string): Promise<DonneesExcel | null> {
  return Excel.run(async context => {
    const t = await trouverTableaux(context, nomFeuille);
    if (!t.noeuds && !t.liens) return null;

    const rNoeuds = t.noeuds ? corpsAvecEntete(t.noeuds) : null;
    const rLiens = t.liens ? corpsAvecEntete(t.liens) : null;
    if (rNoeuds) rNoeuds.load("values");
    if (rLiens) rLiens.load("values");
    await context.sync();                                          // sync 3

    const nodes: NoeudExcel[] = [];
    if (t.noeuds && rNoeuds) {
      const ix = t.noeuds.index;
      const col = (ligne: unknown[], nom: string): unknown => {
        const i = ix.get(nom);
        return i === undefined ? "" : ligne[i];
      };
      for (const ligne of lignesDonnees(rNoeuds.values)) {
        if (ligneVide(ligne)) continue;
        const name = texte(col(ligne, "Noeud")).trim();
        if (!name) continue;
        nodes.push({
          id: texte(col(ligne, "ID")).trim() || null,
          name,
          column: toInt(col(ligne, "Numéro de colonne d'affichage"), 1),
          title: texte(col(ligne, "Intitulé de la colonne d'affichage")),
          order: toInt(col(ligne, "Ordre vertical d'affichage"), 0),
          lane: Math.max(1, toInt(col(ligne, "Couloir"), 1)),
          kind: typeDepuisTexte(col(ligne, "Type")),
          filiere: texte(col(ligne, "Filière")),
          color: texte(col(ligne, "Couleur")).trim() || null
        });
      }
    }

    const links: LienExcel[] = [];
    if (t.liens && rLiens) {
      const ix = t.liens.index;
      const col = (ligne: unknown[], nom: string): unknown => {
        const i = ix.get(nom);
        return i === undefined ? "" : ligne[i];
      };
      for (const ligne of lignesDonnees(rLiens.values)) {
        if (ligneVide(ligne)) continue;
        const s = texte(col(ligne, "Origine")).trim();
        const d = texte(col(ligne, "Destination")).trim();
        if (!s || !d) continue;
        links.push({
          sourceId: texte(col(ligne, "ID origine")).trim() || null,
          targetId: texte(col(ligne, "ID destination")).trim() || null,
          sourceName: s,
          targetName: d,
          value: toNum(col(ligne, "Valeur du flux"), 0),
          unit: texte(col(ligne, "Unité"))
        });
      }
    }

    // Un classeur écrit avant l'arrivée des couloirs (ou des types) n'a pas la
    // colonne : l'app doit alors GARDER ce qu'elle connaît au lieu de tout
    // remettre au défaut.
    return {
      sheetName: t.feuille || nomFeuille || FEUILLE_DEFAUT,
      nodes,
      links,
      hasLane: !!(t.noeuds && t.noeuds.index.has("Couloir")),
      hasKind: !!(t.noeuds && t.noeuds.index.has("Type"))
    };
  });
}

/**
 * Formules « Valeur du flux » du classeur, indexées `id:<src> <tgt>` puis
 * `name:<Origine> <Destination>` — **sans le « = » initial**, comme le <f> du
 * XML, pour que les deux chemins d'écriture partagent la même convention.
 */
export async function lireFormules(nomFeuille?: string): Promise<Formules> {
  return Excel.run(async context => {
    const t = await trouverTableaux(context, nomFeuille);
    if (!t.liens) return {};
    const r = corpsAvecEntete(t.liens);
    r.load("values, formulas");
    await context.sync();                                          // sync 3

    return collecterFormules(t.liens, r.values, r.formulas);
  });
}

/** Extrait la table des formules à partir de valeurs + formules déjà chargées. */
function collecterFormules(
  liens: TableauTrouve, valeurs: unknown[][], formules: unknown[][]
): Formules {
  const out: Formules = {};
  const ix = liens.index;
  const iVal = ix.get("Valeur du flux");
  if (iVal === undefined) return out;
  const iOn = ix.get("Origine"), iDn = ix.get("Destination");
  const iOi = ix.get("ID origine"), iDi = ix.get("ID destination");

  const lignesV = lignesDonnees(valeurs);
  const lignesF = lignesDonnees(formules);
  for (let i = 0; i < lignesF.length; i++) {
    const brute = texte(lignesF[i][iVal]);
    if (brute.charAt(0) !== "=") continue;      // pas une formule : rien à préserver
    const formule = brute.slice(1);             // convention : sans le « = »
    const v = lignesV[i] || [];
    const oNom = iOn === undefined ? "" : texte(v[iOn]);
    const dNom = iDn === undefined ? "" : texte(v[iDn]);
    const oId = iOi === undefined ? "" : texte(v[iOi]);
    const dId = iDi === undefined ? "" : texte(v[iDi]);
    if (oId && dId) out["id:" + oId + " " + dId] = formule;
    if (oNom && dNom) out["name:" + oNom + " " + dNom] = formule;
  }
  return out;
}

/* ------------------------------ ÉCRITURE ------------------------------ */

/** Valeur d'une cellule pour `.values` (le calcul, jamais la formule). */
function valeurDe(c: Cellule): string | number {
  if (c.t === "n") return c.v;
  if (c.t === "f") return c.v;
  return c.v;
}
/** Contenu d'une cellule pour `.formulas` : la formule si elle existe. */
function formuleDe(c: Cellule): string | number {
  return c.t === "f" ? "=" + c.f : valeurDe(c);
}

export interface ResultatEcriture {
  ok: boolean;
  sheetName: string;
  /** Nombre de formules « Valeur du flux » préservées. */
  formules: number;
  /** Excel a-t-il enregistré (seulement si options.save). */
  enregistre: boolean;
  ms: number;
  error?: string;
}

/**
 * Écrit le diagramme dans le classeur ouvert.
 *
 * Déroulé, et pourquoi chaque sync est nécessaire :
 *   sync 1-2  repérage des tableaux (trouverTableaux)
 *   sync 3    relecture des formules existantes + hauteur actuelle des tableaux
 *   sync 4    ajustement du nombre de lignes (ajouts / suppressions)
 *   sync 5    écriture des colonnes — toutes les affectations d'un coup
 *   sync 6    enregistrement, UNIQUEMENT si options.save
 *
 * L'enregistrement n'est demandé que sur un « App → Excel » explicite : sinon
 * OneDrive téléverserait à chaque frappe.
 */
export async function ecrireDiagramme(
  model: Modele, nomFeuille?: string, options?: OptionsEcriture
): Promise<ResultatEcriture> {
  const t0 = Date.now();
  return Excel.run(async context => {
    const t = await trouverTableaux(context, nomFeuille);
    if (!t.noeuds || !t.liens) {
      return {
        ok: false, sheetName: nomFeuille || FEUILLE_DEFAUT, formules: 0,
        enregistre: false, ms: Date.now() - t0,
        error: !t.noeuds && !t.liens
          ? "Tableaux « Noeuds » et « Liens » introuvables dans le classeur"
          : (!t.noeuds ? "Tableau des nœuds introuvable (en-tête « Noeud »)"
                       : "Tableau des liens introuvable (en-tête « Origine »)")
      };
    }

    // --- sync 3 : formules à préserver + hauteur actuelle des deux tableaux.
    const rLiens = corpsAvecEntete(t.liens);
    rLiens.load("values, formulas");
    const nLignes = t.noeuds.table.rows;
    const lLignes = t.liens.table.rows;
    nLignes.load("count");
    lLignes.load("count");
    await context.sync();                                          // sync 3

    const formules = collecterFormules(t.liens, rLiens.values, rLiens.formulas);
    const carte = new Map<string, string>(Object.entries(formules));

    // Le tri des lignes et la réémission des formules viennent du module
    // partagé : identiques à l'écriture du .xlsx, par construction.
    const { nodeRows, linkRows } = buildModelRows(model, carte);

    // --- sync 4 : ajuster la hauteur avant d'écrire.
    ajusterLignes(t.noeuds, nLignes.count, nodeRows.length);
    ajusterLignes(t.liens, lLignes.count, linkRows.length);
    await context.sync();                                          // sync 4

    // --- sync 5 : écrire, colonne par colonne, par nom d'en-tête.
    ecrireColonnes(t.noeuds, NODE_COLS, nodeRows);
    ecrireColonnes(t.liens, LINK_COLS, linkRows, "Valeur du flux");
    await context.sync();                                          // sync 5

    let enregistre = false;
    if (options && options.save) {
      context.workbook.save(Excel.SaveBehavior.save);
      await context.sync();                                        // sync 6
      enregistre = true;
    }

    return {
      ok: true,
      sheetName: t.feuille || nomFeuille || FEUILLE_DEFAUT,
      formules: nombreDeFormulesReemises(linkRows),
      enregistre,
      ms: Date.now() - t0
    };
  });
}

function nombreDeFormulesReemises(linkRows: Cellule[][]): number {
  let n = 0;
  for (const ligne of linkRows) for (const c of ligne) if (c.t === "f") n++;
  return n;
}

/**
 * Amène le tableau à `voulu` lignes de données (au moins une : un tableau Excel
 * ne peut pas être vide). N'affecte QUE les colonnes du tableau — sinon le
 * tableau voisin, sur les mêmes lignes, se décalerait avec lui.
 */
function ajusterLignes(t: TableauTrouve, actuel: number, voulu: number): void {
  const cible = Math.max(MIN_LIGNES, voulu);
  if (cible === actuel) return;

  if (cible > actuel) {
    // Ajout : des lignes vides, remplies juste après par ecrireColonnes.
    const largeur = t.entetes.length;
    const vides: string[][] = [];
    for (let i = 0; i < cible - actuel; i++) vides.push(new Array(largeur).fill(""));
    t.table.rows.add(undefined, vides);
    return;
  }

  // Retrait : on supprime le surplus par le bas, en remontant les cellules.
  // getOffsetRange(cible) descend le bloc de `cible` lignes ; getResizedRange
  // (-cible) le ramène à `actuel - cible` lignes -> exactement le surplus.
  const corps = t.table.getDataBodyRange();
  corps.getOffsetRange(cible, 0).getResizedRange(-cible, 0)
    .delete(Excel.DeleteShiftDirection.up);
}

/**
 * Écrit les colonnes connues, une par une, en les retrouvant par leur en-tête.
 * Une colonne du classeur que nous ne connaissons pas n'est PAS touchée ; une
 * de nos colonnes absente du classeur est simplement ignorée (c'est ce qui rend
 * `hasLane`/`hasKind` possibles).
 *
 * `colonneFormule` désigne la colonne à écrire en `.formulas` plutôt qu'en
 * `.values` : c'est « Valeur du flux », la seule qui peut porter un calcul.
 */
function ecrireColonnes(
  t: TableauTrouve, nos: string[], lignes: Cellule[][], colonneFormule?: string
): void {
  const corps = t.table.getDataBodyRange();
  const hauteur = Math.max(MIN_LIGNES, lignes.length);

  nos.forEach((nom, iNotre) => {
    const iClasseur = t.index.get(nom);
    if (iClasseur === undefined) return;          // colonne absente du classeur
    const formule = nom === colonneFormule;
    const donnees: (string | number)[][] = [];
    for (let r = 0; r < hauteur; r++) {
      const cellule = lignes[r] ? lignes[r][iNotre] : undefined;
      if (!cellule) { donnees.push([""]); continue; }
      donnees.push([formule ? formuleDe(cellule) : valeurDe(cellule)]);
    }
    const colonne = corps.getColumn(iClasseur);
    if (formule) colonne.formulas = donnees;
    else colonne.values = donnees;
  });
}

/* ------------------------------ ÉVÈNEMENTS ------------------------------ */

/** Ce qu'Excel passe à un gestionnaire de `Table.onChanged`. */
export interface EvenementTableau {
  triggerSource?: string;
  source?: string;
  address?: string;
  tableId?: string;
}

export interface Ecoute {
  ok: boolean;
  /** Noms des tableaux réellement écoutés. */
  tables: string[];
  error?: string;
}

/**
 * Branche un gestionnaire sur les modifications des DEUX tableaux du diagramme
 * — et sur eux seuls : un classeur réel en porte d'autres (le poste d'essai en
 * avait trois), dont les modifications ne nous concernent pas.
 *
 * `onChanged` exige ExcelApi 1.7 ; l'appelant sonde le jeu d'exigences avant
 * (cf. PLAN §3 : jamais déclaré dans le manifeste, toujours sondé à l'exécution).
 */
export async function ecouterTableaux(
  gestionnaire: (e: EvenementTableau) => void, nomFeuille?: string
): Promise<Ecoute> {
  return Excel.run(async context => {
    const t = await trouverTableaux(context, nomFeuille);
    const cibles = [t.noeuds, t.liens].filter(Boolean) as TableauTrouve[];
    if (!cibles.length) {
      return { ok: false, tables: [], error: "Tableaux du diagramme introuvables" };
    }
    const noms: string[] = [];
    for (const c of cibles) {
      c.table.onChanged.add(async e => { gestionnaire(e as EvenementTableau); });
      noms.push(c.table.name);
    }
    await context.sync();                                          // sync 3
    return { ok: true, tables: noms };
  });
}
