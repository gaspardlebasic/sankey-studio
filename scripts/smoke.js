/**
 * Test de fumée de l'éditeur, sans automatisation de fenêtre.
 *
 * Charge le renderer construit dans une fenêtre Electron masquée et exerce les
 * fonctionnalités par évènements souris/clavier, via le crochet `window.__sankeyTest`.
 * C'est le moyen de vérifier une fonctionnalité de bout en bout ici : ni la fenêtre
 * Electron ni les dialogues natifs ne sont pilotables autrement.
 *
 * Usage : npm run smoke   (sortie non nulle si un test échoue)
 */
"use strict";
const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
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

  // --- garde-fou : édition refusée quand Excel tient le classeur ET que
  // l'app ne sait pas y écrire ; autorisée quand elle le sait.
  T.setExcelPath('/tmp/inexistant.xlsx');
  T.setExcelLocked(true);
  T.setExcelLive(false);
  const avantGarde = T.nodeCount();
  document.querySelector('#toolbar button').click(); // ＋ Nœud
  out.garde_fou_excel = T.nodeCount() === avantGarde;
  T.setExcelLive(true);
  document.querySelector('#toolbar button').click();
  out.edition_pendant_ecriture_a_chaud = T.nodeCount() === avantGarde + 1;
  T.setExcelLocked(false); T.setExcelLive(false); T.setExcelPath(null);

  return out;
})()`;

const results = [];
function record(obj) {
  for (const [name, ok] of Object.entries(obj)) results.push({ name, ok: !!ok });
}

// La fenêtre du test est autonome : on remplace les canaux Excel de main.js par
// des bouchons, sinon chaque appel IPC du renderer échoue bruyamment.
function stubExcelIpc() {
  ipcMain.handle("excel:isLocked", () => ({ locked: false, exists: false, mode: "absent", live: false }));
  ipcMain.handle("excel:watch", () => ({ ok: true, locked: false }));
  ipcMain.handle("excel:read", () => ({ ok: false, error: "bouchon" }));
  ipcMain.handle("excel:write", () => ({ ok: false, error: "bouchon" }));
  ipcMain.handle("excel:closeInExcel", () => ({ ok: true, state: "not-running", locked: false }));
  ipcMain.handle("excel:formulas", () => ({ ok: true, formules: {} }));
  ipcMain.handle("clipboard:write", (_e, text) => {
    try {
      clipboard.writeText(text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}

app.whenReady().then(async () => {
  stubExcelIpc();
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, "src/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await win.loadFile(path.join(ROOT, "dist/renderer/index.html"));
    // Repart d'un projet vierge : l'app recharge alors le diagramme d'exemple.
    await win.webContents.executeJavaScript('localStorage.clear()');
    win.reload();
    await new Promise(r => setTimeout(r, 1200));

    record(await win.webContents.executeJavaScript(SCENARIO));

    // --- titre de la fenêtre = projet ouvert
    record({ titre_sans_projet: win.getTitle() === "Sankey Studio" });
    await win.webContents.executeJavaScript(
      'localStorage.setItem("sankey-project-path", "/Users/x/mon-diagramme.sankey")'
    );
    win.reload();
    await new Promise(r => setTimeout(r, 1000));
    record({ titre_avec_projet: win.getTitle() === "mon-diagramme.sankey" });
    await win.webContents.executeJavaScript('localStorage.clear()');
  } catch (e) {
    results.push({ name: "exécution du scénario", ok: false, err: String((e && e.message) || e) });
  }

  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? "ok  " : "ÉCHEC"}  ${r.name}${r.err ? " — " + r.err : ""}`));
  console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
  app.exit(failed.length ? 1 : 0);
});
