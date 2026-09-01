"use strict";
/**
 * Faux Office.js — un classeur en mémoire, juste assez fidèle pour éprouver
 * src/addin/excel-office.ts sans Excel.
 *
 * Ce qu'il reproduit VOLONTAIREMENT, parce que ce sont les pièges du vrai :
 *
 *  - **Le différé.** Une propriété chargée par `load()` n'est lisible qu'après
 *    `sync()`, et une affectation n'est appliquée qu'au `sync()` suivant. Un
 *    code qui lit avant de synchroniser échoue ici comme dans Excel.
 *  - **Le décalage limité aux colonnes du tableau.** Ajouter ou supprimer une
 *    ligne d'un tableau ne bouge QUE ses propres colonnes. C'est l'invariant
 *    qui empêche le tableau des liens de glisser quand celui des nœuds grandit.
 *
 * Ce qu'il ne reproduit pas : le recalcul des formules (une formule reste une
 * chaîne), la mise en forme, les évènements.
 */

/* ------------------------------ grille ------------------------------ */

class Grille {
  constructor() { this.cellules = new Map(); }        // "r,c" -> { v, f }
  cle(r, c) { return r + "," + c; }
  lire(r, c) { return this.cellules.get(this.cle(r, c)) || { v: "", f: "" }; }
  ecrire(r, c, cel) { this.cellules.set(this.cle(r, c), cel); }

  /** Décale vers le bas, UNIQUEMENT dans les colonnes [c0, c0+nCols). */
  insererLignes(r0, n, c0, nCols) {
    const bougees = [];
    for (const [k, val] of this.cellules) {
      const [r, c] = k.split(",").map(Number);
      if (c >= c0 && c < c0 + nCols && r >= r0) bougees.push([r, c, val]);
    }
    bougees.sort((a, b) => b[0] - a[0]);              // du bas vers le haut
    for (const [r, c] of bougees) this.cellules.delete(this.cle(r, c));
    for (const [r, c, val] of bougees) this.cellules.set(this.cle(r + n, c), val);
  }

  /** Remonte les cellules, UNIQUEMENT dans les colonnes [c0, c0+nCols). */
  supprimerLignes(r0, n, c0, nCols) {
    for (let c = c0; c < c0 + nCols; c++) {
      for (let r = r0; r < r0 + n; r++) this.cellules.delete(this.cle(r, c));
    }
    const bougees = [];
    for (const [k, val] of this.cellules) {
      const [r, c] = k.split(",").map(Number);
      if (c >= c0 && c < c0 + nCols && r >= r0 + n) bougees.push([r, c, val]);
    }
    bougees.sort((a, b) => a[0] - b[0]);              // du haut vers le bas
    for (const [r, c] of bougees) this.cellules.delete(this.cle(r, c));
    for (const [r, c, val] of bougees) this.cellules.set(this.cle(r - n, c), val);
  }
}

/* ------------------------------ plage ------------------------------ */

class FausseP1age {
  constructor(ctx, grille, r0, c0, lignes, colonnes) {
    this.ctx = ctx; this.grille = grille;
    this.r0 = r0; this.c0 = c0; this.lignes = lignes; this.colonnes = colonnes;
    this._charge = new Set();
    this._values = undefined; this._formulas = undefined;
  }

  load(props) {
    String(props).split(",").map(s => s.trim()).filter(Boolean)
      .forEach(p => this._charge.add(p));
    this.ctx._aCharger.push(this);
    return this;
  }

  get values() {
    if (this._values === undefined) throw new Error("values lu avant sync()");
    return this._values;
  }
  get formulas() {
    if (this._formulas === undefined) throw new Error("formulas lu avant sync()");
    return this._formulas;
  }
  set values(v) { this.ctx._file.push({ type: "values", plage: this, data: v }); }
  set formulas(v) { this.ctx._file.push({ type: "formulas", plage: this, data: v }); }

  get rowCount() { return this.lignes; }
  get columnCount() { return this.colonnes; }
  get address() {
    return `R${this.r0 + 1}C${this.c0 + 1}:R${this.r0 + this.lignes}C${this.c0 + this.colonnes}`;
  }

  getColumn(i) {
    return new FausseP1age(this.ctx, this.grille, this.r0, this.c0 + i, this.lignes, 1);
  }
  getOffsetRange(dr, dc) {
    return new FausseP1age(this.ctx, this.grille, this.r0 + dr, this.c0 + dc,
                           this.lignes, this.colonnes);
  }
  getResizedRange(dLignes, dColonnes) {
    return new FausseP1age(this.ctx, this.grille, this.r0, this.c0,
                           this.lignes + dLignes, this.colonnes + dColonnes);
  }
  delete(sens) {
    if (sens !== "Up") throw new Error("seul le décalage vers le haut est modélisé");
    this.ctx._file.push({ type: "delete", plage: this });
  }

  _resoudre() {
    const grille = (quoi) => {
      const out = [];
      for (let r = 0; r < this.lignes; r++) {
        const ligne = [];
        for (let c = 0; c < this.colonnes; c++) {
          const cel = this.grille.lire(this.r0 + r, this.c0 + c);
          ligne.push(quoi === "formulas" && cel.f ? cel.f : cel.v);
        }
        out.push(ligne);
      }
      return out;
    };
    if (this._charge.has("values")) this._values = grille("values");
    if (this._charge.has("formulas")) this._formulas = grille("formulas");
  }
}

/* ------------------------------ tableau ------------------------------ */

class FauxTableau {
  constructor(ctx, def) {
    this.ctx = ctx; this.def = def;
    this.name = def.nom;
    this.worksheet = { name: def.feuille };
    // Évènements : le vrai Excel n'appelle le gestionnaire qu'après le sync
    // qui l'enregistre. Ici on retient les gestionnaires ; le test les
    // déclenche lui-même (modifierTableau), comme le ferait une frappe.
    this.onChanged = {
      _t: this,
      add(fn) { this._t.def.gestionnaires.push(fn); return this; }
    };
    this.rows = {
      _t: this,
      _charge: false,
      load(p) {
        if (String(p).includes("count")) { this._charge = true; this._t.ctx._aCharger.push(this); }
        return this;
      },
      get count() {
        if (this._n === undefined) throw new Error("rows.count lu avant sync()");
        return this._n;
      },
      add: (index, valeurs) => {
        this.ctx._file.push({ type: "addRows", table: this, valeurs: valeurs });
      },
      _resoudre() { this._n = this._t.def.lignes; }
    };
  }
  getHeaderRowRange() {
    return new FausseP1age(this.ctx, this.def.grille, this.def.r0, this.def.c0,
                           1, this.def.entetes.length);
  }
  getRange() {
    return new FausseP1age(this.ctx, this.def.grille, this.def.r0, this.def.c0,
                           this.def.lignes + 1, this.def.entetes.length);
  }
  getDataBodyRange() {
    return new FausseP1age(this.ctx, this.def.grille, this.def.r0 + 1, this.def.c0,
                           this.def.lignes, this.def.entetes.length);
  }
}

/* ------------------------------ contexte ------------------------------ */

class FauxContexte {
  constructor(classeur) {
    this._classeur = classeur;
    this._file = [];
    this._aCharger = [];
    this.enregistrements = 0;
    const ctx = this;
    const tables = classeur.tables.map(def => new FauxTableau(this, def));
    this.workbook = {
      tables: {
        items: tables,
        load() { ctx._aCharger.push(this); return this; },
        _resoudre() { /* items sont déjà là */ }
      },
      save() { ctx._file.push({ type: "save" }); }
    };
  }

  async sync() {
    for (const op of this._file) this._appliquer(op);
    this._file = [];
    for (const o of this._aCharger) if (o._resoudre) o._resoudre();
    this._aCharger = [];
  }

  _appliquer(op) {
    if (op.type === "save") { this.enregistrements++; return; }

    if (op.type === "addRows") {
      const def = op.table.def;
      const n = op.valeurs.length;
      // Excel insère les lignes DANS le tableau : décalage limité à ses colonnes.
      def.grille.insererLignes(def.r0 + 1 + def.lignes, n, def.c0, def.entetes.length);
      op.valeurs.forEach((ligne, i) => {
        ligne.forEach((v, c) => {
          def.grille.ecrire(def.r0 + 1 + def.lignes + i, def.c0 + c, { v: v, f: "" });
        });
      });
      def.lignes += n;
      return;
    }

    if (op.type === "delete") {
      const p = op.plage;
      const def = this._tableauContenant(p);
      // Invariant du vrai Excel, et raison d'être de cette classe : une
      // suppression de lignes dans un tableau ne doit porter QUE sur ses
      // colonnes. Plus large, elle ferait remonter le tableau voisin — le bug
      // est alors masqué par l'écriture qui suit, donc aucune assertion ne le
      // verrait. On l'interdit ici plutôt que d'espérer le détecter.
      if (def && p.colonnes !== def.entetes.length) {
        throw new Error(
          `suppression sur ${p.colonnes} colonnes alors que le tableau « ${def.nom} » ` +
          `en compte ${def.entetes.length} : le tableau voisin se décalerait`);
      }
      p.grille.supprimerLignes(p.r0, p.lignes, p.c0, p.colonnes);
      if (def) def.lignes -= p.lignes;
      return;
    }

    // values / formulas
    const p = op.plage;
    op.data.forEach((ligne, r) => {
      ligne.forEach((v, c) => {
        const ancienne = p.grille.lire(p.r0 + r, p.c0 + c);
        const estFormule = op.type === "formulas" && typeof v === "string" && v.charAt(0) === "=";
        p.grille.ecrire(p.r0 + r, p.c0 + c, {
          v: estFormule ? ancienne.v : v,        // la valeur calculée ne bouge pas
          f: estFormule ? v : ""
        });
      });
    });
  }

  /** Quel tableau porte cette plage ? (pour tenir à jour son nombre de lignes) */
  _tableauContenant(p) {
    return this._classeur.tables.find(
      d => d.grille === p.grille && d.c0 === p.c0 && p.r0 > d.r0
    );
  }
}

/* ------------------------------ montage ------------------------------ */

/**
 * Construit un classeur en mémoire et installe les globales `Excel`.
 * tables : [{ nom, feuille, entetes, lignes: [[...]], r0, c0 }]
 * Une cellule peut être une valeur, ou { f: "=..." , v: 12 } pour une formule.
 */
function monterClasseur(tables) {
  const grille = new Grille();
  const defs = tables.map(t => {
    const r0 = t.r0 || 0, c0 = t.c0 || 0;
    t.entetes.forEach((h, c) => grille.ecrire(r0, c0 + c, { v: h, f: "" }));
    (t.lignes || []).forEach((ligne, r) => {
      ligne.forEach((cel, c) => {
        const est = cel && typeof cel === "object" && cel.f;
        grille.ecrire(r0 + 1 + r, c0 + c, est ? { v: cel.v, f: cel.f } : { v: cel, f: "" });
      });
    });
    return {
      nom: t.nom, feuille: t.feuille || "Diagramme", entetes: t.entetes,
      lignes: (t.lignes || []).length, r0, c0, grille, gestionnaires: []
    };
  });

  const classeur = { tables: defs, grille };
  let dernier = null;

  global.Excel = {
    DeleteShiftDirection: { up: "Up", left: "Left" },
    SaveBehavior: { save: "Save", prompt: "Prompt" },
    async run(fn) {
      const ctx = new FauxContexte(classeur);
      dernier = ctx;
      const r = await fn(ctx);
      await ctx.sync();          // le vrai Excel.run synchronise en sortant
      return r;
    }
  };

  return {
    classeur,
    /** Relit un tableau sous forme de lignes de valeurs (hors en-tête). */
    lignesDe(nom) {
      const d = defs.find(x => x.nom === nom);
      const out = [];
      for (let r = 0; r < d.lignes; r++) {
        const ligne = [];
        for (let c = 0; c < d.entetes.length; c++) ligne.push(grille.lire(d.r0 + 1 + r, d.c0 + c).v);
        out.push(ligne);
      }
      return out;
    },
    /** Relit les formules d'un tableau ("" quand la cellule n'en porte pas). */
    formulesDe(nom) {
      const d = defs.find(x => x.nom === nom);
      const out = [];
      for (let r = 0; r < d.lignes; r++) {
        const ligne = [];
        for (let c = 0; c < d.entetes.length; c++) ligne.push(grille.lire(d.r0 + 1 + r, d.c0 + c).f);
        out.push(ligne);
      }
      return out;
    },
    hauteurDe(nom) { return defs.find(x => x.nom === nom).lignes; },
    /** Cellule brute, pour vérifier qu'une colonne étrangère n'a pas bougé. */
    cellule(r, c) { return grille.lire(r, c); },
    enregistrements() { return dernier ? dernier.enregistrements : 0; },
    /** Noms des tableaux sur lesquels un gestionnaire onChanged est posé. */
    tablesEcoutees() {
      return defs.filter(d => d.gestionnaires.length).map(d => d.nom);
    },
    /** Joue une modification de tableau, comme une frappe dans Excel. */
    modifierTableau(nom, evenement) {
      const d = defs.find(x => x.nom === nom);
      if (!d) throw new Error("tableau inconnu : " + nom);
      const e = Object.assign({ type: "TableChanged", tableId: nom, source: "Local" }, evenement);
      d.gestionnaires.forEach(fn => fn(e));
      return d.gestionnaires.length;
    }
  };
}

module.exports = { monterClasseur };
