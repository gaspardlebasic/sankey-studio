"use strict";
/**
 * Simulateur ONLYOFFICE Spreadsheet API pour les tests automatisés en Node.js.
 * Reproduit window.Asc.plugin.callCommand, ApiWorksheet, ApiListObject,
 * ApiRange et ApiCustomProperties en mémoire.
 */

class Grille {
  constructor() {
    this.cellules = new Map(); // "r,c" -> { v, f }
  }
  cle(r, c) { return r + "," + c; }
  lire(r, c) { return this.cellules.get(this.cle(r, c)) || { v: "", f: "" }; }
  ecrire(r, c, cel) { this.cellules.set(this.cle(r, c), cel); }
}

function parseA1(ref) {
  const m = String(ref).trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!m) return { r1: 0, c1: 0, r2: 0, c2: 0 };
  const colEnNum = s => {
    let n = 0;
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.toUpperCase().charCodeAt(i) - 64);
    return n - 1;
  };
  const c1 = colEnNum(m[1]);
  const r1 = parseInt(m[2], 10) - 1;
  const c2 = m[3] ? colEnNum(m[3]) : c1;
  const r2 = m[4] ? parseInt(m[4], 10) - 1 : r1;
  return { r1, c1, r2, c2 };
}

class FaussePlage {
  constructor(grille, r1, c1, r2, c2) {
    this.grille = grille;
    this.r1 = Math.min(r1, r2);
    this.c1 = Math.min(c1, c2);
    this.r2 = Math.max(r1, r2);
    this.c2 = Math.max(c1, c2);
  }

  GetRow() { return this.r1; }
  GetCol() { return this.c1; }

  GetValue() {
    const nbLignes = this.r2 - this.r1 + 1;
    const nbCols = this.c2 - this.c1 + 1;
    if (nbLignes === 1 && nbCols === 1) {
      return this.grille.lire(this.r1, this.c1).v;
    }
    const res = [];
    for (let r = this.r1; r <= this.r2; r++) {
      const ligne = [];
      for (let c = this.c1; c <= this.c2; c++) {
        ligne.push(this.grille.lire(r, c).v);
      }
      res.push(ligne);
    }
    return res;
  }

  SetValue(data) {
    if (Array.isArray(data)) {
      for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (Array.isArray(row)) {
          for (let c = 0; c < row.length; c++) {
            const cur = this.grille.lire(this.r1 + r, this.c1 + c);
            this.grille.ecrire(this.r1 + r, this.c1 + c, { v: row[c], f: cur.f });
          }
        } else {
          const cur = this.grille.lire(this.r1 + r, this.c1);
          this.grille.ecrire(this.r1 + r, this.c1, { v: row, f: cur.f });
        }
      }
      return true;
    }
    for (let r = this.r1; r <= this.r2; r++) {
      for (let c = this.c1; c <= this.c2; c++) {
        const cur = this.grille.lire(r, c);
        this.grille.ecrire(r, c, { v: data, f: cur.f });
      }
    }
    return true;
  }

  GetFormula() {
    const nbLignes = this.r2 - this.r1 + 1;
    const nbCols = this.c2 - this.c1 + 1;
    if (nbLignes === 1 && nbCols === 1) {
      return this.grille.lire(this.r1, this.c1).f;
    }
    const res = [];
    for (let r = this.r1; r <= this.r2; r++) {
      const ligne = [];
      for (let c = this.c1; c <= this.c2; c++) {
        ligne.push(this.grille.lire(r, c).f);
      }
      res.push(ligne);
    }
    return res;
  }

  SetFormula(formula) {
    const fStr = String(formula || "");
    for (let r = this.r1; r <= this.r2; r++) {
      for (let c = this.c1; c <= this.c2; c++) {
        const cur = this.grille.lire(r, c);
        this.grille.ecrire(r, c, { v: cur.v, f: fStr });
      }
    }
    return true;
  }

  Clear() {
    for (let r = this.r1; r <= this.r2; r++) {
      for (let c = this.c1; c <= this.c2; c++) {
        this.grille.ecrire(r, c, { v: "", f: "" });
      }
    }
  }
}

class FausseListObject {
  constructor(ws, name, range) {
    this.ws = ws;
    this.name = name;
    this.range = range;
  }
  GetName() { return this.name; }
  _actualiserPlage() {
    let c = this.range.c2 + 1;
    while (c < 40) {
      const v = this.ws.grille.lire(this.range.r1, c).v;
      if (!v || String(v).trim() === "") break;
      c++;
    }
    this.range.c2 = c - 1;
  }
  GetRange() {
    this._actualiserPlage();
    return this.range;
  }
  GetHeaderRowRange() {
    this._actualiserPlage();
    return new FaussePlage(this.ws.grille, this.range.r1, this.range.c1, this.range.r1, this.range.c2);
  }
  GetDataBodyRange() {
    this._actualiserPlage();
    if (this.range.r2 <= this.range.r1) return null;
    return new FaussePlage(this.ws.grille, this.range.r1 + 1, this.range.c1, this.range.r2, this.range.c2);
  }
}

class FausseWorksheet {
  constructor(name) {
    this.name = name;
    this.grille = new Grille();
    this.tables = [];
  }
  GetName() { return this.name; }
  SetName(n) { this.name = n; }

  GetRangeByNumber(r, c) {
    return new FaussePlage(this.grille, r, c, r, c);
  }

  GetRange(ref) {
    const { r1, c1, r2, c2 } = parseA1(ref);
    return new FaussePlage(this.grille, r1, c1, r2, c2);
  }

  GetListObjects() {
    return this.tables.slice();
  }

  AddListObject(range, name) {
    const t = new FausseListObject(this, name, range);
    this.tables.push(t);
    return t;
  }
}

class FauxCustomProperties {
  constructor() {
    this.props = new Map();
  }
  Add(k, v) { this.props.set(k, v); }
  Get(k) { return this.props.has(k) ? this.props.get(k) : null; }
}

class FauxEnvironnementOnlyOffice {
  constructor() {
    this.sheets = [new FausseWorksheet("Diagramme")];
    this.activeSheet = this.sheets[0];
    this.customProperties = new FauxCustomProperties();
  }

  monterGlobal() {
    const self = this;
    const api = {
      GetActiveSheet() { return self.activeSheet; },
      GetSheets() { return self.sheets.slice(); },
      AddWorksheet(name) {
        const ws = new FausseWorksheet(name);
        self.sheets.push(ws);
        self.activeSheet = ws;
        return ws;
      },
      GetCustomProperties() { return self.customProperties; }
    };

    global.window = global.window || {};
    global.window.Asc = global.window.Asc || {};
    global.window.Asc.scope = global.window.Asc.scope || {};

    const plugin = {
      callCommand(func, isClose, isAnimate, cb) {
        // Exécute dans le contexte où Api et Asc.scope sont définis
        const oldApi = global.Api;
        const oldAsc = global.Asc;
        global.Api = api;
        global.Asc = global.window.Asc;

        try {
          const ret = func();
          if (typeof cb === "function") cb(ret);
        } finally {
          global.Api = oldApi;
          global.Asc = oldAsc;
        }
      }
    };

    global.window.Asc.plugin = plugin;
    global.Asc = global.window.Asc;
  }
}

/** Prépare un classeur en mémoire avec des données de test. */
function monterClasseurOnlyOffice(tables) {
  const env = new FauxEnvironnementOnlyOffice();
  const ws = env.sheets[0];

  for (const t of tables) {
    const r0 = t.r0 || 0;
    const c0 = t.c0 || 0;
    // En-têtes
    for (let c = 0; c < t.entetes.length; c++) {
      ws.GetRangeByNumber(r0, c0 + c).SetValue(t.entetes[c]);
    }
    // Lignes de données
    const lignes = t.lignes || [];
    for (let r = 0; r < lignes.length; r++) {
      const row = lignes[r];
      for (let c = 0; c < row.length; c++) {
        const val = row[c];
        const cell = ws.GetRangeByNumber(r0 + 1 + r, c0 + c);
        if (typeof val === "string" && val.startsWith("=")) {
          cell.SetFormula(val);
        } else {
          cell.SetValue(val);
        }
      }
    }
    // ListObject
    const rMax = Math.max(r0 + lignes.length, r0 + 1);
    const cMax = c0 + t.entetes.length - 1;
    const range = new FaussePlage(ws.grille, r0, c0, rMax, cMax);
    ws.AddListObject(range, t.nom);
  }

  env.monterGlobal();
  return env;
}

module.exports = {
  FauxEnvironnementOnlyOffice,
  monterClasseurOnlyOffice
};
