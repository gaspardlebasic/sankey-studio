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
  getCell(r, c) {
    return new FausseP1age(this.ctx, this.grille, this.r0 + r, this.c0 + c, 1, 1);
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

/* ------------------------------ feuille ------------------------------ */

/** A, B, … Z, AA — pour rendre une adresse lisible dans les messages. */
function lettre(c) {
  let n = c + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = (n - r - 1) / 26; }
  return out;
}

/** getUsedRangeOrNullObject : nul sur une feuille vierge, sinon son étendue. */
class FaussePlageUtilisee {
  constructor(ctx, grille) {
    this.ctx = ctx; this.grille = grille;
    this._resolu = false; this._nul = undefined; this._adresse = undefined;
  }
  load(props) { void props; this.ctx._aCharger.push(this); return this; }
  get isNullObject() {
    if (!this._resolu) throw new Error("isNullObject lu avant sync()");
    return this._nul;
  }
  get address() {
    if (!this._resolu) throw new Error("address lu avant sync()");
    return this._adresse;
  }
  _resoudre() {
    let r1 = null, r2 = 0, c1 = null, c2 = 0;
    for (const [k, cel] of this.grille.cellules) {
      if ((cel.v === "" || cel.v === null || cel.v === undefined) && !cel.f) continue;
      const [r, c] = k.split(",").map(Number);
      if (r1 === null || r < r1) r1 = r;
      if (c1 === null || c < c1) c1 = c;
      if (r > r2) r2 = r;
      if (c > c2) c2 = c;
    }
    this._resolu = true;
    this._nul = r1 === null;
    this._adresse = this._nul ? null : lettre(c1) + (r1 + 1) + ":" + lettre(c2) + (r2 + 1);
  }
}

class FausseFeuille {
  constructor(ctx, nom) {
    this.ctx = ctx;
    this.name = nom;
    this.grille = ctx._classeur.grillePour(nom);
    this.activee = false;
    const feuille = this;
    this.tables = {
      /**
       * Les en-têtes sont lues DANS LA GRILLE, tout de suite. Un appelant qui
       * pose ses en-têtes puis crée le tableau sans synchroniser entre les deux
       * obtient donc un tableau sans en-tête — exactement ce que fait Excel, et
       * c'est le genre d'ordre qu'un faux doit faire respecter.
       */
      add(plage, avecEntetes) {
        const entetes = [];
        for (let c = 0; c < plage.colonnes; c++) {
          entetes.push(feuille.grille.lire(plage.r0, plage.c0 + c).v);
        }
        const def = {
          nom: "Tableau" + (ctx._classeur.tables.length + 1), feuille: nom, entetes,
          lignes: avecEntetes ? plage.lignes - 1 : plage.lignes,
          r0: plage.r0, c0: plage.c0, grille: feuille.grille, gestionnaires: []
        };
        ctx._classeur.tables.push(def);
        return {
          get name() { return def.nom; },
          set name(v) {
            // Excel refuse deux tableaux de même nom, dans TOUT le classeur.
            if (ctx._classeur.tables.some(d => d !== def && d.nom === v)) {
              throw new Error("nom de tableau déjà pris : " + v);
            }
            def.nom = v;
          }
        };
      }
    };
  }
  getRangeByIndexes(r0, c0, lignes, colonnes) {
    return new FausseP1age(this.ctx, this.grille, r0, c0, lignes, colonnes);
  }
  getUsedRangeOrNullObject() { return new FaussePlageUtilisee(this.ctx, this.grille); }
  activate() { this.activee = true; }
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
    this._feuilles = new Map();
    this.workbook = {
      tables: {
        items: tables,
        load() { ctx._aCharger.push(this); return this; },
        _resoudre() { /* items sont déjà là */ }
      },
      worksheets: {
        items: [],
        load() { ctx._aCharger.push(this); return this; },
        _resoudre() { this.items = ctx._nomsFeuilles().map(n => ctx._feuille(n)); },
        getItem(nom) { return ctx._feuille(nom); },
        add(nom) {
          if (ctx._nomsFeuilles().indexOf(nom) >= 0) {
            throw new Error("feuille déjà présente : " + nom);
          }
          ctx._classeur.feuillesNues.push(nom);
          return ctx._feuille(nom);
        }
      },
      save() { ctx._file.push({ type: "save" }); }
    };
  }

  /** Les feuilles du classeur : celles qui portent un tableau, et les nues. */
  _nomsFeuilles() {
    const out = [];
    for (const d of this._classeur.tables) if (out.indexOf(d.feuille) < 0) out.push(d.feuille);
    for (const f of this._classeur.feuillesNues) if (out.indexOf(f) < 0) out.push(f);
    return out;
  }

  /** Une seule instance par nom : `getItem` deux fois rend le même objet. */
  _feuille(nom) {
    if (!this._feuilles.has(nom)) this._feuilles.set(nom, new FausseFeuille(this, nom));
    return this._feuilles.get(nom);
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
    // Excel, lui, DIFFUSE un tableau à une ligne sur toute la plage — c'est
    // ainsi qu'une seule formule a rempli une colonne entière. Le faux refuse
    // plutôt que de diffuser : un désaccord de dimensions est un défaut, et il
    // doit se voir ici avant de se voir dans le classeur de quelqu'un.
    if (op.data.length !== p.lignes) {
      throw new Error(
        `affectation de ${op.data.length} ligne(s) sur une plage qui en compte ` +
        `${p.lignes} (${p.address}) : Excel diffuserait la valeur sur toute la plage`);
    }
    op.data.forEach((ligne, r) => {
      ligne.forEach((v, c) => {
        const ancienne = p.grille.lire(p.r0 + r, p.c0 + c);
        const estFormule = op.type === "formulas" && typeof v === "string" && v.charAt(0) === "=";
        // Excel ne garde pas la formule telle qu'on la lui donne : il la range
        // dans SA forme (fonctions en anglais, lien vers un autre classeur
        // réécrit avec son chemin). Le faux sait jouer cette réécriture.
        const normalise = this._classeur.normalise;
        p.grille.ecrire(p.r0 + r, p.c0 + c, {
          v: estFormule ? ancienne.v : v,        // la valeur calculée ne bouge pas
          f: estFormule ? (normalise ? normalise(v) : v) : ""
        });
      });
    });
    this._commeUnExcelQuiRecopie(op);
  }

  /**
   * L'EXCEL QUI RECOPIE — le comportement qui a détruit deux fois l'affectation
   * des valeurs dans « Flux APS.xlsx », et qu'aucun faux ne reproduisait.
   *
   * Une formule qui se pose dans une colonne de tableau peut décider Excel à en
   * faire une COLONNE CALCULÉE : il l'étend aussitôt à toutes les lignes, par
   * -dessus les nombres. Deux duretés, parce que nous ne savons pas laquelle est
   * la vraie :
   *
   *  - `passagere` : la recopie a lieu, mais toute écriture ultérieure gagne.
   *    Reposer les nombres dans le même envoi suffit alors à la défaire.
   *  - `colonneCalculee` : Excel TIENT sa colonne. Une écriture de valeurs sur
   *    une PARTIE de la colonne est aussitôt recouverte par la formule ; seule
   *    une écriture de la colonne ENTIÈRE en valeurs, qui n'y laisse plus une
   *    seule formule, la lui fait abandonner.
   *  - `colonneEntiere` : celui qu'on a VU à l'œuvre le 2026-09-07. Seule une
   *    affectation de la COLONNE ENTIÈRE en `.formulas` déclenche la recopie —
   *    Excel y lit la formule de la colonne. Une formule posée sur UNE cellule
   *    ne déclenche rien, et rien n'est tenu ensuite : c'est ce qui a permis
   *    aux lignes en nombres de survivre pendant que les dix formules
   *    distinctes étaient remplacées par la première.
   */
  _commeUnExcelQuiRecopie(op) {
    const mode = this._classeur.recopie;
    if (!mode) return;
    const p = op.plage;
    for (let c = 0; c < p.colonnes; c++) {
      const col = p.c0 + c;
      const def = this._tableauDeLaCellule(p.grille, p.r0, col);
      if (!def) continue;
      const calculees = def.calculees || (def.calculees = new Map());

      if (op.type === "formulas") {
        // La colonne ENTIÈRE, ou seulement quelques cellules ?
        const colonneEntiere = p.r0 <= def.r0 + 1 && p.r0 + p.lignes >= def.r0 + 1 + def.lignes;
        if (mode === "colonneEntiere" && !colonneEntiere) continue;
        // La PREMIÈRE formule de l'affectation gagne : Excel y lit la formule
        // de la colonne, et c'est bien la première qu'on a vue se propager.
        let f = "";
        for (let r = 0; r < p.lignes && !f; r++) {
          const v = (op.data[r] || [])[c];
          if (typeof v === "string" && v.charAt(0) === "=") f = v;
        }
        if (!f) continue;
        if (mode !== "colonneEntiere") calculees.set(col, f);
        this._etendreALaColonne(def, col, f);
        continue;
      }

      const f = calculees.get(col);
      if (!f) continue;
      const couvreTout = p.r0 <= def.r0 + 1 && p.r0 + p.lignes >= def.r0 + 1 + def.lignes;
      // Plus une seule formule dans la colonne : Excel abandonne la colonne calculée.
      if (couvreTout) { calculees.delete(col); continue; }
      if (mode === "colonneCalculee") this._etendreALaColonne(def, col, f);
    }
  }

  /** Pose `f` sur toute la colonne du tableau, avec la valeur qu'elle produit. */
  _etendreALaColonne(def, col, f) {
    let v = "";
    for (let r = 0; r < def.lignes; r++) {
      const cel = def.grille.lire(def.r0 + 1 + r, col);
      if (cel.f === f) { v = cel.v; break; }
    }
    for (let r = 0; r < def.lignes; r++) def.grille.ecrire(def.r0 + 1 + r, col, { v: v, f: f });
  }

  /** Le tableau dont le CORPS contient cette cellule, s'il y en a un. */
  _tableauDeLaCellule(grille, r, c) {
    return this._classeur.tables.find(
      d => d.grille === grille &&
           r >= d.r0 + 1 && r < d.r0 + 1 + d.lignes &&
           c >= d.c0 && c < d.c0 + d.entetes.length
    );
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
 * options.recopie : « passagere » ou « colonneCalculee » pour jouer un Excel
 * qui transforme en colonne calculée toute colonne où une formule se pose.
 */
function monterClasseur(tables, options) {
  // UNE GRILLE PAR FEUILLE. Deux tableaux d'une même feuille partagent la
  // leur — c'est ce qui fait que l'un peut décaler l'autre, l'invariant que
  // cette classe existe pour éprouver. Deux feuilles, elles, s'ignorent.
  const grilles = new Map();
  const grillePour = nom => {
    if (!grilles.has(nom)) grilles.set(nom, new Grille());
    return grilles.get(nom);
  };
  const defs = tables.map(t => {
    const r0 = t.r0 || 0, c0 = t.c0 || 0;
    const feuille = t.feuille || "Diagramme";
    const grille = grillePour(feuille);
    t.entetes.forEach((h, c) => grille.ecrire(r0, c0 + c, { v: h, f: "" }));
    (t.lignes || []).forEach((ligne, r) => {
      ligne.forEach((cel, c) => {
        const est = cel && typeof cel === "object" && cel.f;
        grille.ecrire(r0 + 1 + r, c0 + c, est ? { v: cel.v, f: cel.f } : { v: cel, f: "" });
      });
    });
    return {
      nom: t.nom, feuille, entetes: t.entetes,
      lignes: (t.lignes || []).length, r0, c0, grille, gestionnaires: []
    };
  });

  // Une feuille peut exister sans porter de tableau : `feuillesNues` les
  // déclare, pour éprouver le refus d'écrire sur une feuille déjà occupée.
  const classeur = {
    tables: defs, grilles, grillePour, feuillesNues: [],
    // « passagere » ou « colonneCalculee » : voir _commeUnExcelQuiRecopie.
    recopie: (options && options.recopie) || null,
    // Réécriture d'une formule par Excel au moment où il la range.
    normalise: (options && options.normalise) || null
  };
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
        for (let c = 0; c < d.entetes.length; c++) ligne.push(d.grille.lire(d.r0 + 1 + r, d.c0 + c).v);
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
        for (let c = 0; c < d.entetes.length; c++) ligne.push(d.grille.lire(d.r0 + 1 + r, d.c0 + c).f);
        out.push(ligne);
      }
      return out;
    },
    hauteurDe(nom) { return defs.find(x => x.nom === nom).lignes; },
    /** Cellule brute, pour vérifier qu'une colonne étrangère n'a pas bougé. */
    cellule(r, c, feuille) { return classeur.grillePour(feuille || "Diagramme").lire(r, c); },
    /** Les tableaux d'une feuille, dans l'ordre où le classeur les porte. */
    tablesDe(feuille) {
      return classeur.tables.filter(d => d.feuille === feuille).map(d => d.nom);
    },
    /** Les en-têtes d'un tableau, telles qu'Excel les a prises. */
    entetesDe(nom) {
      const d = classeur.tables.find(x => x.nom === nom);
      return d ? d.entetes.slice() : null;
    },
    /** Les feuilles du classeur, tableaux et feuilles nues confondus. */
    feuilles() {
      const vues = [];
      for (const d of classeur.tables) if (vues.indexOf(d.feuille) < 0) vues.push(d.feuille);
      for (const f of classeur.feuillesNues) if (vues.indexOf(f) < 0) vues.push(f);
      return vues;
    },
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
