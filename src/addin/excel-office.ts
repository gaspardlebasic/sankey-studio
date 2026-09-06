/**
 * Adaptateur Office.js — lecture/écriture du diagramme dans le classeur OUVERT.
 *
 * Le schéma — colonnes, ordre de tri, types, préservation des formules — n'est
 * PAS redéfini ici : il vient de src/shared/modele-excel.js.
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
  NODE_COLS, LINK_COLS, LINK_COL_BIO, LINK_COLS_ECRITES, NODE_START, LINK_START,
  buildModelRows, toInt, toNum, typeDepuisTexte, partBioDepuisTexte
} from "../shared/modele-excel.js";
import type {
  Cellule, FormulePreservee, Modele, NodeKind
} from "../shared/modele-excel.js";

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
  /** Part du flux en bio / durable, de 0 à 1 (0 = colonne vide ou absente). */
  bio: number;
}
export interface DonneesExcel {
  nodes: NoeudExcel[];
  links: LienExcel[];
  /** Le classeur porte-t-il la colonne « Couloir » ? Sinon l'app garde les siennes. */
  hasLane?: boolean;
  /** Idem pour « Type ». */
  hasKind?: boolean;
  /** Le tableau des liens porte-t-il « Part bio / durable » ? */
  hasBio?: boolean;
  sheetName?: string;
}

export interface OptionsEcriture {
  /** Demander à Excel d'enregistrer après l'écriture. Réservé à un « App → Excel » explicite. */
  save?: boolean;
}

/**
 * Formules « Valeur du flux » retrouvées dans le classeur, indexées par
 * `id:…` puis `name:…`. Les deux clés d'une même ligne portent le même
 * `source` : buildModelRows s'en sert pour ne servir chaque formule qu'UNE fois.
 */
export type Formules = Map<string, FormulePreservee>;

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
 * d'abord celle qu'on demande (« Diagramme » par défaut). Ce n'était pas la
 * règle au départ : le premier essai dans Excel a repéré comme
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

/* --------------------------- INITIALISATION --------------------------- */

export interface Initialisation {
  ok: boolean;
  /** La feuille qui porte (désormais) le diagramme. */
  feuille?: string;
  /** Vrai quand il n'y avait rien à faire : le classeur était déjà prêt. */
  deja?: boolean;
  error?: string;
}

/**
 * Le classeur peut-il accueillir l'éditeur ? C'est la question du volet avant
 * d'ouvrir la fenêtre : sur un classeur nu, il n'y a rien à éditer et il vaut
 * mieux proposer de le préparer.
 */
export async function diagrammePresent(nomFeuille?: string): Promise<boolean> {
  try {
    return await Excel.run(async context => {
      const t = await trouverTableaux(context, nomFeuille);
      return !!(t.noeuds && t.liens);
    });
  } catch {
    return false;                 // illisible = pas exploitable : même conclusion
  }
}

/** Un nom de tableau libre dans le classeur — Excel les veut uniques. */
function nomLibre(base: string, pris: string[]): string {
  if (pris.indexOf(base) < 0) return base;
  for (let i = 2; ; i++) {
    const essai = base + i;
    if (pris.indexOf(essai) < 0) return essai;
  }
}

/**
 * Prépare un classeur nu à recevoir un diagramme : une feuille « Diagramme »,
 * et les deux tableaux vides aux en-têtes du schéma partagé.
 *
 * **Cette fonction écrit dans le classeur de l'utilisatrice** — d'où trois
 * refus plutôt qu'un dégât :
 *
 *  1. un diagramme complet existe déjà : rien à faire, on le dit ;
 *  2. la feuille visée existe et **n'est pas vide** : on n'écrit pas par-dessus
 *     ce qu'on n'a pas mis là. Ça couvre aussi le demi-diagramme (un seul des
 *     deux tableaux), qu'il vaut mieux réparer à la main que deviner ;
 *  3. toute erreur d'Office rend un `{ ok: false, error }` — jamais une levée :
 *     l'appelant est un bouton de volet, pas un bloc `try`.
 *
 * Les tableaux sont créés avec **une ligne vide** : un tableau Excel ne peut
 * pas en avoir zéro. Leur **nom n'a aucune importance** pour la suite — tout le
 * reste de cet adaptateur les retrouve par leurs en-têtes — mais Excel les veut
 * uniques, d'où `nomLibre`.
 */
export async function initialiserClasseur(nomFeuille?: string): Promise<Initialisation> {
  const cible = nomFeuille || FEUILLE_DEFAUT;
  try {
    return await Excel.run(async context => {
      const t = await trouverTableaux(context, cible);
      if (t.noeuds && t.liens) {
        return { ok: false, deja: true, feuille: t.feuille,
                 error: "Ce classeur porte déjà un diagramme." };
      }

      // Les noms déjà pris, pour n'en écraser aucun.
      const tables = context.workbook.tables;
      tables.load("items/name");
      const feuilles = context.workbook.worksheets;
      feuilles.load("items/name");
      await context.sync();                                        // sync 3

      const pris = tables.items.map(x => x.name);
      const existe = feuilles.items.some(f => f.name === cible);

      let feuille: Excel.Worksheet;
      if (existe) {
        feuille = feuilles.getItem(cible);
        // getUsedRange rend un objet nul sur une feuille vierge : c'est la
        // seule façon de distinguer « vide » de « pleine » sans tout lire.
        const utilisee = feuille.getUsedRangeOrNullObject();
        utilisee.load("isNullObject, address");
        await context.sync();                                      // sync 4
        if (!utilisee.isNullObject) {
          return {
            ok: false, feuille: cible,
            error: `L'onglet « ${cible} » existe déjà et n'est pas vide (${utilisee.address}). `
                 + "Renomme-le, vide-le, ou ajoute les deux tableaux à la main."
          };
        }
      } else {
        feuille = feuilles.add(cible);
      }

      const cN = NODE_START - 1;                 // les constantes du schéma sont
      const cL = LINK_START - 1;                 // en base 1 ; Office en base 0
      feuille.getRangeByIndexes(0, cN, 1, NODE_COLS.length).values = [NODE_COLS.slice()];
      feuille.getRangeByIndexes(0, cL, 1, LINK_COLS.length).values = [LINK_COLS.slice()];
      // Les en-têtes doivent être POSÉES avant que le tableau ne les prenne
      // pour siennes : d'où un sync ici. C'est une action ponctuelle, déclenchée
      // par un clic — la règle « un seul aller-retour » ne s'y applique pas.
      await context.sync();                                        // sync 5

      const tN = feuille.tables.add(
        feuille.getRangeByIndexes(0, cN, 1 + MIN_LIGNES, NODE_COLS.length), true);
      tN.name = nomLibre("Noeuds", pris);
      const tL = feuille.tables.add(
        feuille.getRangeByIndexes(0, cL, 1 + MIN_LIGNES, LINK_COLS.length), true);
      tL.name = nomLibre("Liens", pris.concat([tN.name]));
      feuille.activate();
      await context.sync();                                        // sync 6

      return { ok: true, feuille: cible };
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) };
  }
}

/* ------------------------------ LECTURE ------------------------------ */

/**
 * Lit le diagramme dans le classeur ouvert.
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
          unit: texte(col(ligne, "Unité")),
          bio: partBioDepuisTexte(col(ligne, LINK_COL_BIO))
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
      hasKind: !!(t.noeuds && t.noeuds.index.has("Type")),
      hasBio: !!(t.liens && t.liens.index.has(LINK_COL_BIO))
    };
  });
}

/** Un remplissage d'Excel reconnu dans « Valeur du flux », et non réémis. */
export interface Remplissage {
  /** La formule recopiée, « = » compris. */
  formule: string;
  /** Nombre de liens qu'elle occupait. */
  liens: number;
}

/** Ce que la détection rend : les lignes à ne pas préserver, et de quoi le dire. */
interface Remplissages {
  /** Indices, dans le corps du tableau, des lignes issues d'un remplissage. */
  ignorees: Set<number>;
  /** Le plus gros remplissage trouvé — celui qu'on nomme à l'utilisatrice. */
  principal: Remplissage | null;
}

const AUCUN_REMPLISSAGE: Remplissages = { ignorees: new Set(), principal: null };

/**
 * Quelles lignes de « Valeur du flux » sont un REMPLISSAGE d'Excel — pas des
 * données de lien ?
 *
 * POURQUOI CETTE QUESTION EXISTE. Excel a une correction automatique nommée
 * « Remplir les formules dans les tableaux pour créer des colonnes calculées » :
 * dès qu'une formule est saisie dans UNE cellule d'une colonne de tableau, il la
 * recopie sur **toutes les autres lignes**, écrasant les nombres qui s'y
 * trouvaient. Le classeur d'AgriParis Seine a fini ainsi : `='Blé tendre'!$C$8`
 * était la formule légitime du PREMIER lien (la production de blé tendre
 * non-bio) ; Excel l'a posée sur les 149 autres, et l'affectation des valeurs de
 * modélisation aux liens a été détruite.
 *
 * Ce que nous faisions alors : relire ces cellules comme autant de formules
 * d'utilisatrice, et les RÉÉCRIRE toutes à l'identique. Le complément cimentait
 * la corruption — et la recréait dès la première écriture qui suivait une
 * restauration du classeur.
 *
 * CE QUI TRAHIT UNE RECOPIE : **le même texte de formule ET la même valeur
 * calculée sur au moins deux liens.** Deux liens n'ont pas la même valeur de
 * flux par hasard, encore moins depuis la même cellule. Les deux moitiés du
 * critère comptent :
 *
 * - la formule seule ne suffit pas — une vraie colonne calculée, écrite avec
 *   une référence structurée (`=[@Quantité]*1000`), porte le même texte partout
 *   et reste des données ; elle donne des valeurs DIFFÉRENTES ligne à ligne ;
 * - la valeur seule ne suffit pas non plus : deux liens peuvent légitimement
 *   valoir 0.
 *
 * On juge donc LIGNE PAR LIGNE, et pas colonne entière — c'est ce qui rattrape
 * les remplissages PARTIELS. Après une restauration, ou une correction faite à
 * la main sur quelques lignes, une colonne peut porter cent lignes recopiées et
 * trente rescapées : l'ancien critère (« toutes les lignes, la même formule »)
 * la déclarait saine, le complément réémettait la formule sur les cent, et
 * Excel recréait la colonne calculée — tuant les trente survivantes.
 *
 * Les lignes reconnues perdent leur formule : réécrites en `.values`, elles
 * font abandonner à Excel sa colonne calculée. Leur VALEUR, elle, est déjà
 * perdue — Excel l'a écrasée avant nous. D'où l'alerte, remontée jusqu'au volet.
 */
function lignesDeRemplissage(
  liens: TableauTrouve, valeurs: unknown[][], formules: unknown[][]
): Remplissages {
  const iVal = liens.index.get("Valeur du flux");
  if (iVal === undefined) return AUCUN_REMPLISSAGE;
  const lignesV = lignesDonnees(valeurs);
  const lignesF = lignesDonnees(formules);

  // Groupées par (formule, valeur produite) : c'est le couple qui trahit.
  const groupes = new Map<string, { formule: string; lignes: number[] }>();
  for (let i = 0; i < lignesV.length; i++) {
    if (ligneVide(lignesV[i])) continue;          // ligne de réserve : elle ne compte pas
    const f = texte(lignesF[i] ? lignesF[i][iVal] : "");
    if (f.charAt(0) !== "=") continue;            // pas une formule : rien à suspecter
    const cle = f + " " + texte(lignesV[i][iVal]);
    const g = groupes.get(cle);
    if (g) g.lignes.push(i);
    else groupes.set(cle, { formule: f, lignes: [i] });
  }

  const ignorees = new Set<number>();
  let principal: Remplissage | null = null;
  for (const g of groupes.values()) {
    // Une ligne seule ne prouve rien : c'est le cas normal d'un lien qui porte
    // sa formule. Il en faut au moins deux, concordantes.
    if (g.lignes.length < 2) continue;
    for (const i of g.lignes) ignorees.add(i);
    if (!principal || g.lignes.length > principal.liens) {
      principal = { formule: g.formule, liens: g.lignes.length };
    }
  }
  return ignorees.size ? { ignorees, principal } : AUCUN_REMPLISSAGE;
}

/**
 * Extrait la table des formules à partir de valeurs + formules déjà chargées.
 * `ignorees` désigne les lignes qu'un remplissage d'Excel occupe : leur formule
 * n'est pas d'elles, et ne doit surtout pas repartir dans le classeur.
 */
function collecterFormules(
  liens: TableauTrouve, valeurs: unknown[][], formules: unknown[][],
  ignorees: Set<number>
): Formules {
  const out: Formules = new Map();
  const poser = (cle: string, e: FormulePreservee): void => {
    if (!out.has(cle)) out.set(cle, e);      // la première ligne du classeur gagne
  };
  const ix = liens.index;
  const iVal = ix.get("Valeur du flux");
  if (iVal === undefined) return out;
  const iOn = ix.get("Origine"), iDn = ix.get("Destination");
  const iOi = ix.get("ID origine"), iDi = ix.get("ID destination");

  const lignesV = lignesDonnees(valeurs);
  const lignesF = lignesDonnees(formules);
  for (let i = 0; i < lignesF.length; i++) {
    if (ignorees.has(i)) continue;              // recopie d'Excel : pas une formule à nous
    const brute = texte(lignesF[i][iVal]);
    if (brute.charAt(0) !== "=") continue;      // pas une formule : rien à préserver
    const formule = brute.slice(1);             // convention : sans le « = »
    const v = lignesV[i] || [];
    const oNom = iOn === undefined ? "" : texte(v[iOn]);
    const dNom = iDn === undefined ? "" : texte(v[iDn]);
    const oId = iOi === undefined ? "" : texte(v[iOi]);
    const dId = iDi === undefined ? "" : texte(v[iDi]);
    const e: FormulePreservee = { f: formule, source: i };
    if (oId && dId) poser("id:" + oId + " " + dId, e);
    if (oNom && dNom) poser("name:" + oNom + " " + dNom, e);
  }
  return out;
}

/* --------------------- colonnes de l'utilisatrice --------------------- */

/**
 * Les colonnes que nous n'écrivons pas — un « Commentaire », une quantité
 * brute, et « Part bio / durable » que nous LISONS sans jamais l'écrire —
 * appartiennent à l'utilisatrice. On ne les calcule pas : on les fait
 * VOYAGER AVEC LEUR LIGNE.
 *
 * Ne pas y toucher du tout, comme on le faisait, ne les protégeait qu'en
 * apparence : les lignes, elles, sont retriées à chaque écriture
 * (buildModelRows range par filière, colonne, couloir, ordre). Dès la première
 * édition qui change l'ordre, le commentaire se retrouvait en face d'un autre
 * lien — et une formule qui pointait vers une de ces colonnes (« =Q3*1000 »)
 * lisait la ligne du voisin. C'est le décalage signalé.
 *
 * Une ligne nouvelle n'a rien à reprendre : ses colonnes étrangères sont vidées.
 */

/** Ce qui identifie une ligne : une clé forte (les ID), une clé de repli (les noms). */
interface Identite { fortes: string[]; replis: string[]; }

const ID_NOEUD: Identite = { fortes: ["ID"], replis: ["Noeud"] };
const ID_LIEN: Identite = {
  fortes: ["ID origine", "ID destination"], replis: ["Origine", "Destination"]
};

/** Ce qu'on relit d'une cellule : sa formule s'il y en a une, sinon sa valeur. */
type Contenu = string | number | boolean;

function contenu(v: unknown, f: unknown): Contenu {
  const s = texte(f);
  if (s.charAt(0) === "=") return s;             // une formule reste une formule
  if (v === null || v === undefined) return "";
  return v as Contenu;
}

/** Indices, dans le classeur, des colonnes du tableau que nous n'écrivons pas. */
function colonnesEtrangeres(t: TableauTrouve, nos: string[]): number[] {
  const miennes = new Set<number>();
  for (const nom of nos) {
    const i = t.index.get(nom);
    if (i !== undefined) miennes.add(i);
  }
  const out: number[] = [];
  for (let i = 0; i < t.entetes.length; i++) if (!miennes.has(i)) out.push(i);
  return out;
}

/**
 * Pour chaque ligne à écrire, le contenu de la ligne du classeur qui lui
 * correspond — par ID d'abord, par noms ensuite, et **jamais deux fois la
 * même** : deux lignes homonymes (le même « Transport → Pertes » dans deux
 * filières) ne peuvent pas revendiquer la même. Même discipline que les
 * formules, et pour la même raison.
 */
function apparierLignes(
  t: TableauTrouve, nos: string[], ident: Identite,
  valeurs: unknown[][], formules: unknown[][], nouvelles: Cellule[][]
): (Contenu[] | undefined)[] {
  const lignesV = lignesDonnees(valeurs);
  const lignesF = lignesDonnees(formules);

  const cleAncienne = (ligne: unknown[], cols: string[]): string | null => {
    const bouts: string[] = [];
    for (const nom of cols) {
      const i = t.index.get(nom);
      const b = i === undefined ? "" : texte(ligne[i]).trim();
      if (!b) return null;                       // clé incomplète : inutilisable
      bouts.push(b);
    }
    return bouts.join(" ");
  };
  const cleNouvelle = (ligne: Cellule[], cols: string[]): string | null => {
    const bouts: string[] = [];
    for (const nom of cols) {
      const i = nos.indexOf(nom);
      const b = i < 0 ? "" : texte(ligne[i] && ligne[i].v).trim();
      if (!b) return null;
      bouts.push(b);
    }
    return bouts.join(" ");
  };

  const parId = new Map<string, number>();
  const parNom = new Map<string, number>();
  lignesV.forEach((ligne, i) => {
    const id = cleAncienne(ligne, ident.fortes);
    if (id !== null && !parId.has(id)) parId.set(id, i);
    const nom = cleAncienne(ligne, ident.replis);
    if (nom !== null && !parNom.has(nom)) parNom.set(nom, i);
  });

  const source: (number | undefined)[] = new Array(nouvelles.length).fill(undefined);
  const prises = new Set<number>();
  const passe = (cols: string[], table: Map<string, number>): void => {
    nouvelles.forEach((ligne, r) => {
      if (source[r] !== undefined) return;
      const cle = cleNouvelle(ligne, cols);
      if (cle === null) return;
      const i = table.get(cle);
      if (i === undefined || prises.has(i)) return;
      prises.add(i);
      source[r] = i;
    });
  };
  passe(ident.fortes, parId);                    // les ID priment sur les noms
  passe(ident.replis, parNom);

  return source.map(i => {
    if (i === undefined) return undefined;
    const v = lignesV[i] || [], f = lignesF[i] || [];
    const out: Contenu[] = [];
    for (let c = 0; c < t.entetes.length; c++) out.push(contenu(v[c], f[c]));
    return out;
  });
}

/**
 * Une colonne du corps du tableau, HAUTE DE `hauteur` LIGNES EXACTEMENT.
 *
 * `getDataBodyRange().getColumn(c)` prend la hauteur que le tableau a au moment
 * du sync — pas forcément celle du tableau qu'on s'apprête à y verser. Or Excel
 * ne se plaint pas d'un tableau à UNE ligne posé sur une plage qui en compte
 * cent : **il diffuse la valeur sur toute la plage**. Une seule cellule suffit
 * alors à écraser une colonne entière.
 *
 * En partant de la première cellule et en redimensionnant nous-mêmes, la plage
 * fait la hauteur des données par construction : la diffusion devient
 * impossible, et un désaccord se solde par une erreur d'Excel — bruyante, donc
 * réparable — au lieu d'une colonne effacée en silence.
 */
function colonneDuCorps(corps: Excel.Range, c: number, hauteur: number): Excel.Range {
  return corps.getCell(0, c).getResizedRange(hauteur - 1, 0);
}

/** Réécrit les colonnes étrangères, chacune sur la ligne de SON nœud / SON lien. */
function reporterEtrangeres(
  t: TableauTrouve, colonnes: number[], sources: (Contenu[] | undefined)[],
  hauteur: number
): void {
  if (!colonnes.length) return;
  const corps = t.table.getDataBodyRange();
  for (const c of colonnes) {
    const donnees: Contenu[][] = [];
    for (let r = 0; r < hauteur; r++) {
      const src = sources[r];
      const cel = src ? src[c] : "";
      donnees.push([cel === undefined ? "" : cel]);
    }
    // .formulas et non .values : une formule de l'utilisatrice reste une formule.
    colonneDuCorps(corps, c, hauteur).formulas = donnees;
  }
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
  /**
   * Remplissage automatique d'Excel trouvé sur « Valeur du flux » et défait par
   * cette écriture. Absent = rien à signaler. **Présent, il doit être MONTRÉ** :
   * les valeurs de ces liens sont perdues, et seule l'utilisatrice peut le
   * savoir et restaurer une version antérieure du classeur.
   */
  remplissage?: Remplissage;
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

    // --- sync 3 : contenu actuel des deux tableaux (formules à préserver,
    // colonnes de l'utilisatrice à reporter) + leur hauteur.
    const rNoeuds = corpsAvecEntete(t.noeuds);
    const rLiens = corpsAvecEntete(t.liens);
    rNoeuds.load("values, formulas");
    rLiens.load("values, formulas");
    const nLignes = t.noeuds.table.rows;
    const lLignes = t.liens.table.rows;
    nLignes.load("count");
    lLignes.load("count");
    await context.sync();                                          // sync 3

    // Une même formule produisant la même valeur sur plusieurs liens est un
    // remplissage d'Excel, pas des données : on ne la réémet pas, et l'écriture
    // en `.values` qui suit défait la colonne calculée.
    const remplissages = lignesDeRemplissage(t.liens, rLiens.values, rLiens.formulas);
    const carte: Formules = collecterFormules(
      t.liens, rLiens.values, rLiens.formulas, remplissages.ignorees);

    // Le tri des lignes et la réémission des formules viennent du module
    // partagé : identiques à l'écriture du .xlsx, par construction.
    const { nodeRows, linkRows } = buildModelRows(model, carte);

    // Les lignes ayant été retriées, les colonnes que nous n'écrivons pas
    // doivent suivre la leur — sinon elles se retrouvent en face d'un autre
    // nœud, d'un autre lien. L'appariement se fait sur les VALEURS RELUES,
    // donc avant tout ajustement de hauteur.
    const etrNoeuds = colonnesEtrangeres(t.noeuds, NODE_COLS);
    // « Part bio / durable » n'est pas dans les colonnes écrites : elle est donc
    // traitée comme une colonne de l'utilisatrice — sa formule survit, et elle
    // suit son lien au retri, comme un « Commentaire » l'aurait fait.
    const etrLiens = colonnesEtrangeres(t.liens, LINK_COLS_ECRITES);
    const srcNoeuds = etrNoeuds.length
      ? apparierLignes(t.noeuds, NODE_COLS, ID_NOEUD, rNoeuds.values, rNoeuds.formulas, nodeRows)
      : [];
    const srcLiens = etrLiens.length
      ? apparierLignes(t.liens, LINK_COLS_ECRITES, ID_LIEN,
                       rLiens.values, rLiens.formulas, linkRows)
      : [];

    // --- sync 4 : ajuster la hauteur avant d'écrire.
    ajusterLignes(t.noeuds, nLignes.count, nodeRows.length);
    ajusterLignes(t.liens, lLignes.count, linkRows.length);
    await context.sync();                                          // sync 4

    // --- sync 5 : écrire, colonne par colonne, par nom d'en-tête.
    ecrireColonnes(t.noeuds, NODE_COLS, nodeRows);
    ecrireColonnes(t.liens, LINK_COLS_ECRITES, linkRows, "Valeur du flux");
    reporterEtrangeres(t.noeuds, etrNoeuds, srcNoeuds, Math.max(MIN_LIGNES, nodeRows.length));
    reporterEtrangeres(t.liens, etrLiens, srcLiens, Math.max(MIN_LIGNES, linkRows.length));
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
      ms: Date.now() - t0,
      ...(remplissages.principal ? { remplissage: remplissages.principal } : {})
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
    const colonne = colonneDuCorps(corps, iClasseur, hauteur);
    // `.formulas` seulement quand il y a vraiment une formule à poser. Les deux
    // effacent les formules déjà présentes (ce qui défait la colonne calculée) :
    // écrire des nombres en `.values` dit simplement ce qu'on fait.
    if (formule && donnees.some(l => typeof l[0] === "string" && l[0].charAt(0) === "=")) {
      colonne.formulas = donnees;
    } else {
      colonne.values = donnees;
    }
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
