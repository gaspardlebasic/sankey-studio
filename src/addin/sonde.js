"use strict";
/**
 * Sonde — phase 0 du PLAN-COMPLEMENT-EXCEL.md.
 *
 * Répond aux sept questions qui décident du chantier, sans rien engager :
 *   A jeux d'exigences · B lecture des deux tableaux · C écriture chronométrée
 *   D formules préservées · E évènements · F stockage de l'apparence · G largeur du volet
 *
 * Puis, pour la PHASE 6 (validation Windows), les deux questions qui décident :
 *   H le tunnel volet ↔ fenêtre — poids et délai des messages, dans les deux sens
 *   I les polices du diagramme dans la webview d'Office
 *
 * Rien n'est jamais enregistré : le classeur reste « modifié » dans Excel, à
 * l'utilisatrice de décider.
 */

/* ----------------------------- journal ----------------------------- */

var journalEl = null;
// Change à chaque chargement du volet : sert à F2 pour distinguer une relecture
// dans la même session d'Excel d'une vraie survie à la fermeture du classeur.
var sessionId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);

function log(texte, classe) {
  if (!journalEl) journalEl = document.getElementById("journal");
  var d = document.createElement("div");
  d.className = classe || "info";
  d.textContent = texte;
  journalEl.appendChild(d);
  d.scrollIntoView({ block: "nearest" });
}
var ok = function (t) { log(t, "ok"); };
var ko = function (t) { log(t, "ko"); };
var titre = function (t) { log(t, "titre"); };

function erreur(e) {
  var m = (e && e.message) || String(e);
  if (e && e.debugInfo) m += " — " + JSON.stringify(e.debugInfo);
  ko(m);
}

/* -------------------------- outils communs -------------------------- */

var attendre = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/**
 * Retrouve les deux tableaux par leurs EN-TÊTES, jamais par leur adresse —
 * même règle que lireDiagramme(). Un classeur écrit par
 * une ancienne version n'a pas la colonne vide entre les deux tableaux.
 */
async function trouverTableaux(context) {
  var tables = context.workbook.tables;
  tables.load("items/name, items/worksheet/name");
  await context.sync();

  var entetes = tables.items.map(function (t) {
    var r = t.getHeaderRowRange();
    r.load("values");
    return r;
  });
  await context.sync();

  var trouve = { noeuds: null, liens: null, tous: [] };
  tables.items.forEach(function (t, i) {
    var cols = (entetes[i].values && entetes[i].values[0]) || [];
    cols = cols.map(function (c) { return String(c || "").trim(); });
    trouve.tous.push({ nom: t.name, feuille: t.worksheet.name, cols: cols });
    if (cols.indexOf("Noeud") >= 0) trouve.noeuds = { table: t, cols: cols };
    if (cols.indexOf("Origine") >= 0) trouve.liens = { table: t, cols: cols };
  });
  return trouve;
}

/** Lit le corps d'un tableau en .formulas (préserve valeurs ET formules). */
async function lireCorps(context, t) {
  var r = t.table.getDataBodyRange();
  r.load("formulas, rowCount, columnCount, address");
  await context.sync();
  return r;
}

/* --------------------- A · jeux d'exigences --------------------- */

async function verifierExigences() {
  titre("A · Jeux d'exigences");

  var d = Office.context.diagnostics || {};
  log("hôte " + (d.host || "?") + " · plateforme " + (d.platform || Office.context.platform || "?") +
      " · version " + (d.version || "?"));

  var maxExcel = null;
  for (var min = 1; min <= 24; min++) {
    if (Office.context.requirements.isSetSupported("ExcelApi", "1." + min)) maxExcel = "1." + min;
    else break;
  }
  if (!maxExcel) ko("ExcelApi : aucun jeu reconnu (?!)");
  else if (parseFloat(maxExcel.slice(2)) >= 7) ok("ExcelApi jusqu'à " + maxExcel + " — onChanged (1.7) disponible");
  else ko("ExcelApi jusqu'à " + maxExcel + " seulement — onChanged exige 1.7. CRITÈRE D'ABANDON");

  [["TaskPaneApi", "1.1", "élargir le volet (G)"],
   ["Settings", "1.1", "stockage de l'apparence (F)"],
   ["ExcelApi", "1.5", "customXmlParts — repli de stockage"],
   ["DialogApi", "1.1", "repli fenêtre à part"],
   ["DialogApi", "1.2", "messageChild — repli fenêtre à part"]
  ].forEach(function (x) {
    var dispo = Office.context.requirements.isSetSupported(x[0], x[1]);
    (dispo ? ok : ko)(x[0] + " " + x[1] + " : " + (dispo ? "oui" : "non") + " — " + x[2]);
  });
}

/* --------------------- B · lecture des tableaux --------------------- */

async function lireTableaux() {
  titre("B · Lecture des deux tableaux");
  var t0 = performance.now();
  await Excel.run(async function (context) {
    var f = await trouverTableaux(context);
    log(f.tous.length + " tableau(x) dans le classeur : " +
        f.tous.map(function (x) { return x.feuille + "!" + x.nom; }).join(", "));

    if (!f.noeuds) { ko("Aucun tableau ne porte l'en-tête « Noeud »"); return; }
    if (!f.liens) { ko("Aucun tableau ne porte l'en-tête « Origine »"); return; }

    var n = await lireCorps(context, f.noeuds);
    var l = await lireCorps(context, f.liens);
    var ms = Math.round(performance.now() - t0);

    var cellules = n.rowCount * n.columnCount + l.rowCount * l.columnCount;
    ok("Nœuds : " + n.rowCount + " lignes × " + n.columnCount + " col (" + n.address + ")");
    ok("Liens : " + l.rowCount + " lignes × " + l.columnCount + " col (" + l.address + ")");
    ok("Lecture de " + cellules + " cellules en " + ms + " ms");

    log("Colonnes nœuds : " + f.noeuds.cols.join(" | "));
    log("Colonnes liens : " + f.liens.cols.join(" | "));

    // Compat des vieux classeurs : ExcelData.hasLane / hasKind (editor.ts:238)
    var hasLane = f.noeuds.cols.indexOf("Couloir") >= 0;
    var hasKind = f.noeuds.cols.indexOf("Type") >= 0;
    log("hasLane = " + hasLane + " · hasKind = " + hasKind +
        (hasLane && hasKind ? "" : "  → l'app devra garder ses propres valeurs"));
  });
}

/* --------------------- D1 · relevé des formules --------------------- */

async function relevrFormules() {
  titre("D1 · Formules « Valeur du flux »");
  await Excel.run(async function (context) {
    var f = await trouverTableaux(context);
    if (!f.liens) { ko("Tableau des liens introuvable"); return; }
    var i = f.liens.cols.indexOf("Valeur du flux");
    if (i < 0) { ko("Colonne « Valeur du flux » absente"); return; }

    var corps = f.liens.table.getDataBodyRange();
    var col = corps.getColumn(i);
    col.load("formulas, rowCount");
    await context.sync();

    var formules = col.formulas.map(function (r) { return String(r[0]); });
    var avec = formules.filter(function (v) { return v.charAt(0) === "="; });
    ok(avec.length + " formule(s) sur " + formules.length + " lignes");
    avec.slice(0, 5).forEach(function (v) { log("   " + v); });
    if (avec.length > 5) log("   … et " + (avec.length - 5) + " autres");
    if (avec.length) {
      log("Syntaxe US attendue (=SUM…) — c'est celle du <f> du XML, " +
          "les deux chemins d'écriture restent cohérents.");
    }
  });
}

/* ------------ C + D2 · aller-retour neutre chronométré ------------ */

async function allerRetour() {
  titre("C+D2 · Aller-retour neutre (réécriture à l'identique)");
  await Excel.run(async function (context) {
    var f = await trouverTableaux(context);
    if (!f.noeuds || !f.liens) { ko("Tableaux introuvables"); return; }

    // 1. Lire en .formulas : préserve valeurs ET formules.
    var tLire = performance.now();
    var n = await lireCorps(context, f.noeuds);
    var l = await lireCorps(context, f.liens);
    var avantN = JSON.parse(JSON.stringify(n.formulas));
    var avantL = JSON.parse(JSON.stringify(l.formulas));
    var msLire = Math.round(performance.now() - tLire);
    var cellules = n.rowCount * n.columnCount + l.rowCount * l.columnCount;

    // 2. Réécrire les MÊMES contenus — deux affectations de plage, UN seul sync.
    //    C'est tout l'enjeu : le coût est le nombre d'allers-retours, pas de cellules.
    var tEcrire = performance.now();
    f.noeuds.table.getDataBodyRange().formulas = avantN;
    f.liens.table.getDataBodyRange().formulas = avantL;
    await context.sync();
    var msEcrire = Math.round(performance.now() - tEcrire);

    // 3. Relire et comparer cellule à cellule.
    var n2 = await lireCorps(context, f.noeuds);
    var l2 = await lireCorps(context, f.liens);

    var ecarts = [];
    function comparer(a, b, nom, cols) {
      if (a.length !== b.length) { ecarts.push(nom + " : " + a.length + " lignes avant, " + b.length + " après"); return; }
      for (var i = 0; i < a.length; i++) {
        for (var j = 0; j < a[i].length; j++) {
          if (String(a[i][j]) !== String(b[i][j])) {
            ecarts.push(nom + " ligne " + (i + 2) + ", « " + (cols[j] || j) + " » : " +
                        JSON.stringify(a[i][j]) + " → " + JSON.stringify(b[i][j]));
          }
        }
      }
    }
    comparer(avantN, n2.formulas, "Nœuds", f.noeuds.cols);
    comparer(avantL, l2.formulas, "Liens", f.liens.cols);

    ok("Écriture de " + cellules + " cellules en " + msEcrire + " ms" +
       "  (lecture " + msLire + " ms)");
    log("Référence JXA actuelle : ~1 350 ms pour 500 cellules, ~1 s de plancher.");
    if (msEcrire > 5000) ko("Plus de 5 s — CRITÈRE D'ABANDON du plan");

    // D2 : les formules ont-elles survécu ?
    var iVal = f.liens.cols.indexOf("Valeur du flux");
    if (iVal >= 0) {
      var av = avantL.filter(function (r) { return String(r[iVal]).charAt(0) === "="; }).length;
      var ap = l2.formulas.filter(function (r) { return String(r[iVal]).charAt(0) === "="; }).length;
      (av === ap ? ok : ko)("Formules « Valeur du flux » : " + av + " avant, " + ap + " après");
    }

    if (!ecarts.length) ok("Aucun écart — " + cellules + " cellules identiques");
    else {
      ko(ecarts.length + " écart(s) :");
      ecarts.slice(0, 15).forEach(function (e) { log("   " + e); });
      if (ecarts.length > 15) log("   … et " + (ecarts.length - 15) + " autres");
    }
    log("Rien n'a été enregistré : le classeur est « modifié » dans Excel.");
  });
}

/* --------------------- E · évènements --------------------- */

var ecouteActive = false;

async function ecouterModifications(bouton) {
  if (!Office.context.requirements.isSetSupported("ExcelApi", "1.7")) {
    ko("E · onChanged exige ExcelApi 1.7 — indisponible ici");
    return;
  }
  if (ecouteActive) {
    ecouteActive = false;
    bouton.querySelector("b").textContent = "E · Écouter les modifications";
    log("Écoute arrêtée (les gestionnaires restent posés jusqu'au rechargement).");
    return;
  }
  titre("E · Écoute des modifications");
  await Excel.run(async function (context) {
    var f = await trouverTableaux(context);
    var cibles = [];
    if (f.noeuds) cibles.push(["Nœuds", f.noeuds.table]);
    if (f.liens) cibles.push(["Liens", f.liens.table]);
    if (!cibles.length) { ko("Tableaux introuvables"); return; }

    cibles.forEach(function (c) {
      c[1].onChanged.add(async function (e) {
        if (!ecouteActive) return;
        ok("[" + new Date().toLocaleTimeString("fr-FR") + "] " + c[0] +
           " · " + e.changeType + " en " + e.address + " (source : " + e.source + ")");
      });
    });
    await context.sync();
    ecouteActive = true;
    bouton.querySelector("b").textContent = "E · Arrêter l'écoute";
    ok("Écoute posée sur " + cibles.length + " tableau(x). Tape maintenant dans une cellule.");
    log("Attention : nos propres écritures déclencheront aussi l'évènement — " +
        "c'est l'auto-écho à supprimer en phase 3 (équivalent de lastWriteTs).");
  });
}

/* --------------------- F · stockage de l'apparence --------------------- */

function reglagesSauver() {
  return new Promise(function (resolve) {
    Office.context.document.settings.saveAsync(function (r) { resolve(r); });
  });
}

async function testerStockage() {
  titre("F · Stockage de l'apparence (document.settings)");
  if (!Office.context.document || !Office.context.document.settings) {
    ko("document.settings indisponible");
    return;
  }
  var tailles = [1, 10, 100, 500, 1024, 2048]; // Ko
  var dernierOk = 0;
  for (var i = 0; i < tailles.length; i++) {
    var ko_ = tailles[i];
    var charge = JSON.stringify({ version: 1, bourrage: "x".repeat(ko_ * 1024) });
    try {
      Office.context.document.settings.set("sonde-apparence", charge);
      var r = await reglagesSauver();
      if (r.status !== Office.AsyncResultStatus.Succeeded) {
        ko("  " + ko_ + " Ko : saveAsync échoue — " + (r.error && r.error.message));
        break;
      }
      var relu = Office.context.document.settings.get("sonde-apparence");
      if (relu !== charge) { ko("  " + ko_ + " Ko : relecture différente"); break; }
      ok("  " + ko_ + " Ko : écrit et relu");
      dernierOk = ko_;
    } catch (e) { ko("  " + ko_ + " Ko : " + ((e && e.message) || e)); break; }
  }
  Office.context.document.settings.remove("sonde-apparence");
  await reglagesSauver();
  log("Plus grande charge acceptée : " + dernierOk + " Ko.");
  log("Ceci n'éprouve que le CHEMIN d'écriture. F supprime sa clé en partant, donc\n" +
      "le relancer après réouverture ne prouve RIEN : la persistance, c'est F2.");
  log("L'apparence réelle = options + idCounter + hiddenFilieres + colorOverrides " +
      "(PLAN §5.2) — sans le modèle, qui vient d'Excel.");
}

/* --------------------- F2 · persistance du stockage --------------------- */

var CLE_MARQUEUR = "sankey-persistance";

/**
 * Prouve — ou non — que document.settings survit à une fermeture du classeur.
 *
 * Protocole en deux temps, piloté par la présence du marqueur :
 *   1er clic  : aucun marqueur -> on en écrit un, horodaté, de la taille réelle
 *               de l'apparence (~2 Ko). Il faut ENREGISTRER le classeur, le
 *               fermer, le rouvrir, puis recliquer.
 *   2e clic   : le marqueur est retrouvé -> la persistance est prouvée, et on
 *               vérifie qu'il est intact octet pour octet.
 *
 * Contrairement à F, ce test ne supprime rien : c'est tout l'enjeu.
 */
async function testerPersistance() {
  titre("F2 · Persistance du stockage");
  var reglages = Office.context.document && Office.context.document.settings;
  if (!reglages) { ko("document.settings indisponible"); return; }

  var brut = reglages.get(CLE_MARQUEUR);
  var trouve = null;
  if (brut) { try { trouve = JSON.parse(brut); } catch (e) { ko("Marqueur illisible : " + brut.slice(0, 80)); } }

  if (trouve && trouve.ecritLe) {
    var age = Math.round((Date.now() - new Date(trouve.ecritLe).getTime()) / 1000);
    var attendu = "x".repeat(trouve.taille || 0);
    var intact = trouve.bourrage === attendu;
    ok("Marqueur RETROUVÉ, écrit il y a " + age + " s (" +
       new Date(trouve.ecritLe).toLocaleString("fr-FR") + ")");
    (intact ? ok : ko)("Charge utile " + (trouve.taille || 0) + " o : " +
                       (intact ? "intacte" : "ALTÉRÉE"));
    if (trouve.session && trouve.session !== sessionId) {
      ok("Écrit dans une AUTRE session d'Excel — la persistance est prouvée.");
    } else {
      log("⚠︎ Même session d'Excel que l'écriture : ça ne prouve pas encore la " +
          "persistance sur disque. Enregistre, ferme le classeur, rouvre-le, reclique.");
    }
  } else {
    log("Aucun marqueur : c'est le premier passage.");
  }

  // On (re)pose un marqueur frais pour le tour suivant.
  var taille = 2048; // taille réelle de l'apparence mesurée sur les vrais projets
  reglages.set(CLE_MARQUEUR, JSON.stringify({
    ecritLe: new Date().toISOString(), taille: taille,
    session: sessionId, bourrage: "x".repeat(taille)
  }));
  var r = await reglagesSauver();
  if (r.status !== Office.AsyncResultStatus.Succeeded) {
    ko("saveAsync échoue : " + (r.error && r.error.message));
    return;
  }
  ok("Marqueur posé (" + taille + " o).");
  titre("→ Maintenant : ENREGISTRE le classeur (Cmd-S), ferme-le, rouvre-le, reclique F2.");
  log("saveAsync range le réglage dans le classeur en mémoire ; sans Cmd-S il " +
      "n'atteint jamais le fichier.");
}

async function nettoyerMarqueur() {
  var reglages = Office.context.document && Office.context.document.settings;
  if (!reglages) return;
  reglages.remove(CLE_MARQUEUR);
  await reglagesSauver();
  log("Marqueur de persistance effacé (pense à enregistrer le classeur).");
}

/* --------------------- G · largeur du volet --------------------- */

function majLargeur() {
  var e = document.getElementById("largeur");
  if (e) e.textContent = "largeur : " + window.innerWidth + " px";
}

async function elargirVolet() {
  titre("G · Largeur du volet");
  log("Largeur actuelle : " + window.innerWidth + " px · écran " + screen.availWidth + " px");

  var api = Office.extensionLifeCycle && Office.extensionLifeCycle.taskpane;
  if (!api || typeof api.setWidth !== "function") {
    ko("setWidth indisponible (TaskPaneApi 1.1 absent) — élargis le volet à la souris");
  } else {
    // Hors bornes, setWidth ne fait rien ET ne signale pas d'erreur (doc MS) :
    // on descend donc par paliers jusqu'à ce que la largeur bouge vraiment.
    var essais = [
      Math.round(screen.availWidth * 0.5), Math.round(screen.availWidth * 0.4),
      Math.round(screen.availWidth * 0.3), 900, 700, 550
    ];
    for (var i = 0; i < essais.length; i++) {
      var avant = window.innerWidth;
      try { api.setWidth(essais[i]); } catch (e) { ko("setWidth(" + essais[i] + ") : " + e.message); break; }
      await attendre(400);
      if (window.innerWidth > avant + 20) {
        ok("setWidth(" + essais[i] + ") → volet à " + window.innerWidth + " px");
        break;
      }
      log("  setWidth(" + essais[i] + ") sans effet (hors bornes)");
    }
  }

  log("Le maximum sur desktop est 50 % de la fenêtre Excel — élargis aussi à la " +
      "souris pour trouver le vrai plafond, puis note-le.");
  log("Pour mémoire : la phase 4 a TRANCHÉ — l'éditeur ne tient pas dans le volet " +
      "et vit dans une fenêtre séparée (PLAN §5.4). Cette mesure ne sert plus qu'au " +
      "repli de compatibilité, quand DialogApi 1.2 manque.");
  majLargeur();
}

/* ------------------ H · le tunnel volet ↔ fenêtre (phase 6) ------------------ */

/*
 * LA question ouverte du chantier. La solution retenue (PLAN §5.4) fait passer
 * tout le modèle en CHAÎNES entre le volet et la fenêtre d'édition, et
 * Microsoft ne documente aucune limite de taille pour messageParent /
 * messageChild. On la cherche donc à la main, par paliers, dans les deux sens.
 *
 * Ce banc n'utilise PAS src/addin/protocole.ts : ses délais de garde et ses
 * reprises masqueraient exactement ce qu'on veut voir. Un message, une réponse,
 * un chronomètre.
 */

var URL_FENETRE = new URL("sonde-fenetre.html", window.location.href).href;
var fenetre = null;
var attente = null;

/** Paliers, en Ko. Un vrai projet pèse ~35 Ko par message (PLAN phase 4). */
var PALIERS = [1, 10, 50, 100, 250, 500, 1024, 2048, 4096];

/** Au-delà, on considère le message perdu. Généreux : on mesure, on ne juge pas. */
var DELAI_TUNNEL = 15000;

function bourrage(n) { return new Array(n + 1).join("x"); }

function surMessageFenetre(arg) {
  var texte = (arg && arg.message) || "";
  var m;
  try { m = JSON.parse(texte); } catch (e) { return; }
  if (!attente) { log("  (message hors attente : " + m.t + ")"); return; }
  if (attente.attendu !== m.t) return;
  var a = attente;
  attente = null;
  clearTimeout(a.minuteur);
  a.resoudre({ ok: true, m: m, octets: texte.length, ms: Date.now() - a.depart });
}

/** Ouvre la fenêtre de la sonde et attend qu'elle se signale. */
async function ouvrirFenetreSonde() {
  if (fenetre) return true;
  if (!Office.context.requirements.isSetSupported("DialogApi", "1.2")) {
    ko("DialogApi 1.2 absent — messageChild n'existe pas, le tunnel est impossible.");
    ko("CRITÈRE : sur ce poste, l'éditeur resterait dans le volet (repli).");
    return false;
  }
  var pret = new Promise(function (resolve) {
    Office.context.ui.displayDialogAsync(
      URL_FENETRE, { height: 40, width: 40, displayInIframe: false },
      function (r) {
        if (r.status !== Office.AsyncResultStatus.Succeeded) {
          ko("displayDialogAsync : " + ((r.error && r.error.code) || "?") + " " +
             ((r.error && r.error.message) || ""));
          resolve(false);
          return;
        }
        fenetre = r.value;
        fenetre.addEventHandler(Office.EventType.DialogMessageReceived, surMessageFenetre);
        fenetre.addEventHandler(Office.EventType.DialogEventReceived, function (arg) {
          fenetre = null;
          log("  fenêtre fermée (" + ((arg && arg.error) || "?") + ")");
        });
        resolve(true);
      }
    );
  });
  if (!(await pret)) return false;
  // La fenêtre dit « pret » d'elle-même quand son écoute est posée ; on relance
  // un bonjour au cas où elle aurait parlé avant qu'on soit branché.
  var r = await demander({ t: "bonjour" }, "pret", 10000);
  if (!r.ok) { ko("La fenêtre s'est ouverte mais ne répond pas : " + r.motif); return false; }
  ok("Fenêtre ouverte et joignable (" + r.ms + " ms)");
  return true;
}

/** Envoie un message et attend la réponse annoncée. Ne lève jamais. */
function demander(objet, attendu, delai) {
  return new Promise(function (resolve) {
    var texte = JSON.stringify(objet);
    attente = {
      attendu: attendu, resoudre: resolve, depart: Date.now(),
      minuteur: setTimeout(function () {
        attente = null;
        resolve({ ok: false, motif: "aucune réponse en " + (delai / 1000) + " s", envoye: texte.length });
      }, delai)
    };
    try {
      fenetre.messageChild(texte);
    } catch (e) {
      clearTimeout(attente.minuteur);
      attente = null;
      // Un messageChild trop gros peut lever : c'est justement une limite.
      resolve({ ok: false, motif: "messageChild a refusé " + texte.length + " o : " + (e.message || e) });
    }
  });
}

/** Un aller-retour dans un sens, à une taille donnée. */
async function passe(sens, octets) {
  if (sens === "descendant") {
    var r = await demander({ t: "recois", charge: bourrage(octets) }, "recu", DELAI_TUNNEL);
    if (r.ok && r.m.utile !== octets) return { ok: false, motif: "tronqué : " + r.m.utile + " o reçus sur " + octets };
    return r;
  }
  var q = await demander({ t: "envoie", n: octets }, "charge", DELAI_TUNNEL);
  if (q.ok && (q.m.charge || "").length !== octets) {
    return { ok: false, motif: "tronqué : " + (q.m.charge || "").length + " o reçus sur " + octets };
  }
  return q;
}

async function echelle(sens, libelle) {
  log(libelle);
  var dernier = 0;
  for (var i = 0; i < PALIERS.length; i++) {
    var octets = PALIERS[i] * 1024;
    var r = await passe(sens, octets);
    if (!r.ok) { ko("  " + PALIERS[i] + " Ko : " + r.motif); break; }
    ok("  " + PALIERS[i] + " Ko : aller-retour en " + r.ms + " ms");
    dernier = PALIERS[i];
    if (!fenetre) { ko("  la fenêtre s'est fermée"); break; }
  }
  return dernier;
}

/**
 * Le poids du modèle de CE classeur, tel qu'il transiterait à chaque écriture.
 * Reconstruit des objets à partir des en-têtes : légèrement MAJORANT (les
 * en-têtes français sont plus longs que les clés du modèle), donc du bon côté.
 */
async function poidsDuModele() {
  return Excel.run(async function (context) {
    var t = await trouverTableaux(context);
    if (!t.noeuds || !t.liens) { ko("Tableaux du diagramme introuvables — ouvre le bon classeur"); return null; }
    var rn = await lireCorps(context, t.noeuds);
    var rl = await lireCorps(context, t.liens);
    function objets(range, cols) {
      return (range.formulas || []).map(function (ligne) {
        var o = {};
        cols.forEach(function (c, i) { o[c] = ligne[i]; });
        return o;
      });
    }
    var modele = { nodes: objets(rn, t.noeuds.cols), links: objets(rl, t.liens.cols) };
    var texte = JSON.stringify(modele);
    log("Classeur : " + modele.nodes.length + " nœuds, " + modele.links.length + " liens");
    log("Modèle sérialisé : " + Math.round(texte.length / 1024 * 10) / 10 + " Ko (" + texte.length + " o)");
    return texte.length;
  });
}

async function testerTunnel() {
  titre("H · Le tunnel volet ↔ fenêtre");
  if (!(await ouvrirFenetreSonde())) return;

  var haut = await echelle("montant", "Montant (fenêtre → volet, messageParent) :");
  var bas = fenetre ? await echelle("descendant", "Descendant (volet → fenêtre, messageChild) :") : 0;

  log("Plafond observé : montant " + haut + " Ko · descendant " + bas + " Ko.");

  // Puis la mesure qui décide : le vrai modèle de ce classeur.
  var poids = null;
  try { poids = await poidsDuModele(); } catch (e) { erreur(e); }
  if (poids) {
    var r = await passe("descendant", poids);
    if (r.ok) ok("Le modèle réel passe en " + r.ms + " ms (descendant)");
    else ko("Le modèle réel NE PASSE PAS : " + r.motif);
    var marge = Math.min(haut, bas) * 1024 / poids;
    log("Marge : le plafond vaut " + (Math.round(marge * 10) / 10) + " fois le modèle.");
  }

  log("CRITÈRE : le plafond doit tenir plusieurs fois le modèle, et un aller-retour");
  log("rester sous ~200 ms — sinon fragmenter les messages, ou n'envoyer que des");
  log("différences (PLAN §7). Ferme la fenêtre quand tu as noté les chiffres.");
}

function fermerFenetreSonde() {
  if (!fenetre) { log("Aucune fenêtre ouverte."); return; }
  try { fenetre.close(); } catch (e) { /* déjà partie */ }
  fenetre = null;
  ok("Fenêtre refermée.");
}

/* ----------------------- I · polices (phase 6) ----------------------- */

/**
 * Le renderer charge Source Sans Pro en .otf depuis son propre domaine. Rien ne
 * garantit qu'une webview Office l'accepte partout — WKWebView sur Mac, WebView2
 * sur Windows. Sans elle, tout le diagramme retombe sur une police système.
 */
async function verifierPolices() {
  titre("I · Polices du diagramme");
  if (!document.fonts || !document.fonts.load) {
    ko("L'API FontFace est absente de cette webview — vérifie à l'œil dans l'app");
    return;
  }
  var style = document.createElement("style");
  // Un nom à nous : si la police ne charge pas, rien ne peut y répondre à sa place.
  style.textContent = '@font-face { font-family: "Sonde SSP"; font-weight: 400;' +
    ' src: url("fonts/SourceSansPro-Regular.otf") format("opentype"); }';
  document.head.appendChild(style);

  try {
    var faces = await document.fonts.load('400 14px "Sonde SSP"');
    if (!faces.length) {
      ko("Source Sans Pro n'a pas chargé — le diagramme utiliserait une police système");
      log("  (as-tu lancé `npm run build` ? la police est servie depuis dist/addin/fonts)");
      return;
    }
    ok("Source Sans Pro chargée (" + faces.length + " fonte(s))");
  } catch (e) {
    ko("Chargement refusé : " + ((e && e.message) || e));
    return;
  }

  // Chargée ne veut pas dire appliquée : on compare une largeur de texte.
  var mesure = document.createElement("span");
  mesure.textContent = "Production laitière — 5 500 t";
  mesure.style.cssText = "position:fixed;visibility:hidden;font-size:14px;white-space:pre";
  document.body.appendChild(mesure);
  mesure.style.fontFamily = "monospace";
  var avant = mesure.getBoundingClientRect().width;
  mesure.style.fontFamily = '"Sonde SSP", monospace';
  var apres = mesure.getBoundingClientRect().width;
  document.body.removeChild(mesure);
  if (Math.abs(apres - avant) < 0.5) ko("La police charge mais ne s'applique pas (largeurs identiques)");
  else ok("Police appliquée (largeur " + Math.round(avant) + " → " + Math.round(apres) + " px)");
}

/* ----------------------------- câblage ----------------------------- */

function brancher(id, fn, garde) {
  var b = document.getElementById(id);
  b.addEventListener("click", async function () {
    if (garde && b.dataset.arme !== "1") {
      b.dataset.arme = "1";
      b.querySelector("b").textContent = "⚠︎ Cliquer à nouveau pour écrire";
      setTimeout(function () {
        b.dataset.arme = "";
        b.querySelector("b").textContent = "C+D2 · Aller-retour neutre";
      }, 5000);
      return;
    }
    b.dataset.arme = "";
    if (garde) b.querySelector("b").textContent = "C+D2 · Aller-retour neutre";
    b.disabled = true;
    try { await fn(b); } catch (e) { erreur(e); }
    b.disabled = false;
  });
}

Office.onReady(function (info) {
  majLargeur();
  window.addEventListener("resize", majLargeur);
  var p = document.getElementById("plateforme");
  if (p) p.textContent = "plateforme : " + (info.platform || "?") + " · " + (info.host || "?");

  brancher("b-exigences", verifierExigences);
  brancher("b-lecture", lireTableaux);
  brancher("b-formules", relevrFormules);
  brancher("b-largeur", elargirVolet);
  brancher("b-ecriture", allerRetour, true);
  brancher("b-evenements", ecouterModifications);
  brancher("b-stockage", testerStockage);
  brancher("b-persistance", testerPersistance);
  brancher("b-nettoyer", nettoyerMarqueur);
  brancher("b-tunnel", testerTunnel);
  brancher("b-fermer-fenetre", fermerFenetreSonde);
  brancher("b-polices", verifierPolices);
  brancher("b-tout", async function () {
    await verifierExigences();
    await lireTableaux();
    await relevrFormules();
    await testerStockage();
    await elargirVolet();
    await verifierPolices();
    titre("— Reste à lancer à la main : C+D2 (écriture), E (évènements), H (tunnel) —");
  });
  document.getElementById("b-vider").addEventListener("click", function () {
    document.getElementById("journal").textContent = "";
  });

  log("Sonde prête. Ouvre le classeur d'essai (une COPIE), puis « Tout lancer ».");
});
