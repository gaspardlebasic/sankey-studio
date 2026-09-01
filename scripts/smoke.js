/**
 * Test de fumée de l'éditeur, sans automatisation de fenêtre.
 *
 * Charge l'éditeur du complément dans une fenêtre Electron masquée et exerce
 * ses fonctionnalités par évènements souris/clavier, via `window.__sankeyTest`.
 * Electron n'est pas le produit : c'est un navigateur pilotable, le seul qui
 * accepte de vraies frappes et de vrais glissers (cf. tests/pont-essai.js).
 *
 * Usage : npm run smoke   (sortie non nulle si un test échoue)
 */
"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const ROOT = path.join(__dirname, "..");
app.disableHardwareAcceleration();

/* Helpers injectés dans la page avant chaque scénario. */
const PRELUDE = `
const T = window.__sankeyTest;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canvasRect = () => document.querySelector('#canvas').getBoundingClientRect();
const nodeByName = n => T.model().nodes.find(x => x.name === n);
const nodeEl = re => [...document.querySelectorAll('#canvas .edit-node')]
    .find(e => new RegExp(re).test(e.textContent));
const clickNode = re => {
    const el = nodeEl(re), r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
};
const dots = () => [...document.querySelectorAll('#canvas .link-dot')];
// NODE_W = 132, NODE_H = 38 : centre approximatif d'un nœud
const centerOf = n => { const c = canvasRect(); return { x: c.left + n.x + 60, y: c.top + n.y + 19 }; };
const dragFromDot = async (index, targetName) => {
    const c = canvasRect(), g = dots()[index];
    const circle = g.querySelector('.link-dot-circle');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        clientX: c.left + +circle.getAttribute('cx'), clientY: c.top + +circle.getAttribute('cy') }));
    const p = centerOf(nodeByName(targetName));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y }));
    await sleep(50);
    const highlighted = !!document.querySelector('#canvas .edit-node.drop-target');
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: p.x, clientY: p.y }));
    await sleep(80);
    return highlighted;
};
`;

const SCENARIO = `(async () => {
  ${PRELUDE}
  const out = {};

  // --- barre d'outils
  const labels = [...document.querySelectorAll('#toolbar button')].map(b => b.textContent.trim());
  out.toolbar_sans_modes = !labels.some(l => /Déplacer|Lier|Exemple/.test(l));
  const segs = [...document.querySelectorAll('#toolbar .segmented .seg')];
  out.bascule_segmentee = segs.length === 2 && segs[0].classList.contains('active');

  // --- bascule Édition / Aperçu
  segs[1].click(); await sleep(150);
  out.apercu_rendu = !document.querySelector('#canvas .edit-node')
      && !!document.querySelector('#canvas path, #canvas rect');
  document.querySelectorAll('#toolbar .segmented .seg')[0].click(); await sleep(150);
  out.retour_edition = !!document.querySelector('#canvas .edit-node');

  // --- points de liaison sur le nœud sélectionné
  clickNode('Lait'); await sleep(60);
  out.deux_points_de_liaison = dots().length === 2;

  // --- lien sortant (point droit)
  const lait = nodeByName('Lait'), beurre = nodeByName('Beurre');
  const avant = T.model().links.length;
  await dragFromDot(1, 'Beurre');
  const dernier = T.model().links[T.model().links.length - 1];
  out.lien_sortant = T.model().links.length === avant + 1
      && dernier.source === lait.id && dernier.target === beurre.id;

  // --- lien entrant (point gauche)
  clickNode('Crème'); await sleep(60);
  const creme = nodeByName('Crème'), prod = nodeByName('Production');
  const avant2 = T.model().links.length;
  await dragFromDot(0, 'Production');
  const l2 = T.model().links[T.model().links.length - 1];
  out.lien_entrant = T.model().links.length === avant2 + 1
      && l2.source === prod.id && l2.target === creme.id;

  // --- cibles invalides : doublon et boucle
  clickNode('Crème'); await sleep(60);
  const n3 = T.model().links.length;
  const surligneDoublon = await dragFromDot(0, 'Production');
  const surligneBoucle = await (async () => { clickNode('Crème'); await sleep(50); return dragFromDot(1, 'Crème'); })();
  out.cibles_invalides_refusees = !surligneDoublon && !surligneBoucle && T.model().links.length === n3;

  // --- déplacement d'un nœud
  const f = nodeByName('Fromage'), colAvant = f.column, c = canvasRect();
  const el = nodeEl('Fromage');
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: c.left + f.x + 60, clientY: c.top + f.y + 19 }));
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: c.left + f.x + 270, clientY: c.top + f.y + 19 }));
  await sleep(80);
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await sleep(120);
  out.deplacement_de_noeud = nodeByName('Fromage').column === colAvant + 1;

  // --- renommage d'une colonne par double-clic sur son intitulé
  const labelsCol = [...document.querySelectorAll('#canvas .grid-col-label')];
  const cible = labelsCol[1];
  cible.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await sleep(60);
  const champ = document.querySelector('.inline-edit');
  const noeudsAvant = T.nodeCount();
  champ.value = 'Collecte';
  champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(120);
  const col2 = T.model().nodes.filter(n => n.column === 2);
  out.renommage_colonne = col2.length > 0 && col2.every(n => n.title === 'Collecte')
      && T.nodeCount() === noeudsAvant; // le double-clic ne doit pas créer de nœud

  // --- sélecteur de couleurs en surcouche
  clickNode('Lait'); await sleep(60);
  document.querySelector('#sidebar .color-btn').click();
  await sleep(60);
  const cols = document.querySelectorAll('.cp-col');
  out.palette_surcouche = !!document.querySelector('.cp-pop') && cols.length === 17
      && cols[0].children.length === 6;
  const nuance = cols[6].children[4];
  const hex = nuance.dataset.hex;
  nuance.click(); await sleep(80);
  out.couleur_appliquee = nodeByName('Lait').color === hex && !document.querySelector('.cp-pop');

  // --- bascules gras / italique
  const gi = [...document.querySelectorAll('.style-toggle')];
  out.bascules_gras_italique = gi.length >= 2
      && gi[0].classList.contains('bold') && gi[1].classList.contains('italic');

  // --- le panneau ne montre plus de section « Synchronisation Excel »
  out.pas_de_section_synchro = ![...document.querySelectorAll('#sidebar h3, #sidebar h2')]
      .some(h => /Synchronisation Excel/i.test(h.textContent));

  // --- l'éditeur reste éditable : plus aucun garde-fou de classeur ouvert
  const avantAjout = T.nodeCount();
  document.querySelector('#toolbar button').click(); // ＋ Nœud
  out.edition_toujours_possible = T.nodeCount() === avantAjout + 1;

  return out;
})()`;

const results = [];
function record(obj) {
  for (const [name, ok] of Object.entries(obj)) results.push({ name, ok: !!ok });
}

/**
 * Le classeur que le complément est censé lire au démarrage.
 *
 * Il remplace le « diagramme d'exemple » d'autrefois, et c'est mieux ainsi :
 * le scénario passe désormais par le VRAI chemin d'amorçage du complément
 * (`amorcerDepuisClasseur` → `reconcileFromExcel`), au lieu d'un modèle posé en
 * dur dans le renderer. Si l'amorçage casse, le test de fumée le voit.
 */
const CLASSEUR = (() => {
  const n = (id, name, column, title, order, filiere, kind) =>
    ({ id, name, column, title, order, lane: 1, kind, filiere, color: "#e79a3c" });
  const nodes = [
    n("n1", "Production", 1, "Production", 0, "", "industrie"),
    n("n2", "Lait", 2, "", 0, "", "produit"),
    n("n3", "Transformation", 3, "Transformation", 0, "", "industrie"),
    n("n4", "Beurre", 4, "", 0, "Matières grasses", "produit"),
    n("n5", "Crème", 4, "", 1, "Matières grasses", "produit"),
    n("n6", "Fromage", 4, "", 2, "Fromagerie", "produit"),
    n("n7", "Distribution", 5, "Distribution", 0, "", "industrie"),
    n("n8", "Exportation de produits transformés", 6, "", 0, "", "produit"),
    n("n9", "Consommation de produits laitiers", 6, "", 1, "", "produit")
  ];
  const nom = id => nodes.find(x => x.id === id).name;
  const l = (s2, t, value) =>
    ({ sourceId: s2, targetId: t, sourceName: nom(s2), targetName: nom(t), value, unit: "t" });
  return {
    nodes,
    links: [
      l("n1", "n2", 5500000), l("n2", "n3", 5500000),
      l("n3", "n4", 92000), l("n3", "n5", 497000), l("n3", "n6", 652000),
      l("n4", "n7", 92000), l("n5", "n7", 497000), l("n6", "n7", 652000),
      l("n7", "n8", 500000), l("n7", "n9", 741000)
    ],
    hasLane: true,
    hasKind: true
  };
})();

// La fenêtre du test n'a pas d'Excel : on répond à sa place, sinon chaque appel
// du pont d'essai échouerait bruyamment.
function stubExcelIpc() {
  ipcMain.handle("excel:read", () => ({ ok: true, live: true, data: CLASSEUR }));
  ipcMain.handle("excel:write", () => ({ ok: true, live: true, path: "Classeur d'essai.xlsx" }));
  ipcMain.handle("apparence:lire", () => null);
  ipcMain.handle("apparence:ecrire", () => ({ ok: true }));
}

app.whenReady().then(async () => {
  stubExcelIpc();
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, "tests/pont-essai.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await win.loadFile(path.join(ROOT, "dist/renderer/index.html"));
    await new Promise(r => setTimeout(r, 1200));

    // Le diagramme doit venir du classeur, et de lui seul.
    record({
      amorce_depuis_le_classeur: await win.webContents.executeJavaScript(
        'window.__sankeyTest.model().nodes.length === ' + CLASSEUR.nodes.length
      )
    });

    record(await win.webContents.executeJavaScript(SCENARIO));
  } catch (e) {
    results.push({ name: "exécution du scénario", ok: false, err: String((e && e.message) || e) });
  }

  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? "ok  " : "ÉCHEC"}  ${r.name}${r.err ? " — " + r.err : ""}`));
  console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
  app.exit(failed.length ? 1 : 0);
});
