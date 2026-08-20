/**
 * Tests des fonctionnalités d'édition de Sankey Studio.
 *
 * Chaque test charge un projet dans une fenêtre Electron masquée puis pilote
 * l'éditeur par de vrais évènements souris/clavier — c'est le seul moyen de
 * vérifier l'application ici, la fenêtre n'étant pas automatisable autrement.
 *
 * Usage :
 *   npm test                 tous les tests
 *   npm test -- liaison      seulement ceux dont le nom contient « liaison »
 */
"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const HELPERS = require("./helpers.js");

// Un accent grave mal échappé dans helpers.js casserait le code injecté et
// laisserait Electron bloqué sur une boîte d'erreur : on le détecte tout de suite.
try {
  new Function("return (async () => {" + HELPERS + "})");
} catch (e) {
  console.error("tests/helpers.js est invalide : " + e.message);
  process.exit(2);
}
const FIXTURES = {
  complexe: JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/complexe.sankey"), "utf8")),
  compteurPerime: JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/compteur-perime.sankey"), "utf8"))
};

app.disableHardwareAcceleration();

/* ------------------------------- mini-cadre ------------------------------ */

const tests = [];
const filter = process.argv.slice(2).find(a => !a.startsWith("-"));
function test(name, fixture, fn) {
  tests.push({ name, fixture, fn });
}

class Echec extends Error {}
function attendu(condition, message) {
  if (!condition) throw new Echec(message);
}
function egal(reel, attenduV, message) {
  if (JSON.stringify(reel) !== JSON.stringify(attenduV)) {
    throw new Echec(`${message}\n      attendu : ${JSON.stringify(attenduV)}\n      obtenu  : ${JSON.stringify(reel)}`);
  }
}

/* --------------------------------- tests --------------------------------- */

test("bouton + : crée un nœud lié dans la colonne suivante", "complexe", async p => {
  const r = await p(`
    const src = one('Tri, décorticage, conditionnement');
    await selectNode(src.id);
    const avant = nodes().length;
    await clickPlus();
    const nouveaux = nodes().filter(n => !${JSON.stringify([])}.includes(n.id) && n.id !== src.id);
    const cree = nodes()[nodes().length - 1];
    const lien = links().find(l => l.source === src.id && l.target === cree.id);
    return {
      creees: nodes().length - avant,
      colonneSource: src.column,
      colonneCreee: cree.column,
      filiereSource: src.filiere,
      filiereCreee: cree.filiere,
      lienCree: !!lien,
      selection: T.selection()
    };
  `);
  egal(r.creees, 1, "un seul nœud doit être créé");
  egal(r.colonneCreee, r.colonneSource + 1, "le nouveau nœud doit être dans la colonne de droite");
  attendu(r.lienCree, "un lien doit relier le nœud d'origine au nouveau nœud");
  egal(r.filiereCreee, r.filiereSource, "le nouveau nœud doit hériter de la filière");
  egal(r.selection.id ? "sélectionné" : "rien", "sélectionné", "le nouveau nœud doit être sélectionné");
});

test("bouton + : le nœud créé reste visible malgré une filière masquée", "complexe", async p => {
  const r = await p(`
    const src = one('Trempage, cuisson');
    await selectNode(src.id);
    await clickPlus();
    const cree = nodes()[nodes().length - 1];
    return { visible: !!elOf(cree.id), filiere: cree.filiere, masquees: T.hidden() };
  `);
  attendu(r.visible, `le nœud créé (filière ${JSON.stringify(r.filiere)}) doit être rendu`);
});

test("filière : modifier le champ met à jour le nœud", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    const avant = byId(n.id).filiere;
    await setField('Filière', 'Protéagineux');
    return { avant, apres: byId(n.id).filiere, nom: byId(n.id).name };
  `);
  egal(r.apres, "Protéagineux", "la filière saisie doit être enregistrée sur le nœud");
  egal(r.nom, "Féverolle", "le nom ne doit pas être touché par le changement de filière");
});

test("filière : la saisie au clavier n'est pas interrompue", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    const res = await typeField('Filière', 'Protéagineux');
    return { saisi: res.saisi, focus: res.focus, perduApres: res.perduApres,
             surLeNoeud: byId(n.id).filiere };
  `);
  egal(r.saisi, "Protéagineux", "le champ doit contenir tout le texte tapé");
  egal(r.surLeNoeud, "Protéagineux", "le nœud doit porter la filière saisie");
  attendu(r.focus, "le champ doit garder le focus pendant la frappe");
});

test("nom : la saisie au clavier n'est pas interrompue", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    const res = await typeField('Nom', 'Féverole de printemps');
    return { saisi: res.saisi, surLeNoeud: byId(n.id).name };
  `);
  egal(r.saisi, "Féverole de printemps", "le champ doit contenir tout le texte tapé");
  egal(r.surLeNoeud, "Féverole de printemps", "le nœud doit porter le nom saisi");
});

test("filière : basculer un nœud vers une filière masquée le retire de la vue", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    await setField('Filière', 'Blé tendre');
    await sleep(80);
    return { rendu: !!elOf(n.id), toujoursDansLeModele: !!byId(n.id), masquees: T.hidden() };
  `);
  attendu(r.masquees.includes("Blé tendre"), "la filière Blé tendre doit être masquée dans la fixture");
  attendu(!r.rendu, "le nœud passé en filière masquée ne doit plus être rendu");
  attendu(r.toujoursDansLeModele, "le nœud doit rester dans le modèle");
});

test("liaison : relie exactement les deux nœuds visés (cas signalé)", "complexe", async p => {
  const r = await p(`
    const src = one('Production végétale, collecte, stockage');
    const dst = one('Féverolle');
    await selectNode(src.id);
    const avant = links().length;
    const d = await dragLink('out', dst.id);
    const nouveau = links()[links().length - 1];
    return {
      creees: links().length - avant,
      attendu: src.id + '->' + dst.id,
      obtenu: nouveau ? nouveau.source + '->' + nouveau.target : null,
      lisible: nouveau ? desc(nouveau) : null,
      surligne: d.highlighted,
      cibleId: dst.id
    };
  `);
  egal(r.creees, 1, "un lien doit être créé");
  egal(r.obtenu, r.attendu, `le lien doit relier les deux nœuds visés (obtenu : ${r.lisible})`);
  egal(r.surligne, r.cibleId, "le nœud surligné doit être celui qui reçoit le lien");
});

test("liaison : sens entrant depuis le point gauche", "complexe", async p => {
  const r = await p(`
    const cible = one('Restauration scolaire');
    const src = one('Lentilles sèches');
    await selectNode(cible.id);
    const avant = links().length;
    await dragLink('in', src.id);
    return { creees: links().length - avant, existeDeja: true };
  `);
  egal(r.creees, 0, "un lien déjà présent ne doit pas être dupliqué");
});

test("liaison : cible correcte quand deux nœuds portent le même nom", "complexe", async p => {
  const r = await p(`
    const src = one('Féverolle');
    const homonymes = named('Exportation hors bretagne');
    const dst = homonymes.find(n => n.column === 4);
    await selectNode(src.id);
    const d = await dragLink('out', dst.id);
    const nouveau = links()[links().length - 1];
    return {
      nbHomonymes: homonymes.length,
      obtenu: nouveau.source + '->' + nouveau.target,
      attendu: src.id + '->' + dst.id,
      colonneCible: byId(nouveau.target).column
    };
  `);
  attendu(r.nbHomonymes === 2, "la fixture doit contenir deux homonymes");
  egal(r.obtenu, r.attendu, "le lien doit viser le nœud pointé, pas son homonyme");
  egal(r.colonneCible, 4, "l'homonyme de la colonne 4 devait être visé");
});

test("liaison : cible correcte après avoir fait défiler le canevas", "complexe", async p => {
  const r = await p(`
    const wrap = document.querySelector('#canvas-wrap');
    wrap.scrollLeft = 400; wrap.scrollTop = 60;
    await sleep(60);
    if (wrap.scrollLeft === 0) throw new Error('le canevas ne défile pas : test sans valeur');
    const src = one('Lentilles sèches');
    const dst = one('Exportation hors Bretagne');
    await selectNode(src.id);
    const avant = links().length;
    const d = await dragLink('out', dst.id);
    const nouveau = links()[links().length - 1];
    return {
      defilement: wrap.scrollLeft + ',' + wrap.scrollTop,
      debordement: wrap.scrollWidth + 'x' + wrap.scrollHeight + ' dans ' + wrap.clientWidth + 'x' + wrap.clientHeight,
      creees: links().length - avant,
      obtenu: nouveau.source + '->' + nouveau.target,
      attendu: src.id + '->' + dst.id,
      lisible: desc(nouveau)
    };
  `);
  attendu(r.defilement !== "0,0", "le canevas doit réellement défiler (" + r.debordement + ")");
  egal(r.creees, 1, "un lien doit être créé même après défilement");
  egal(r.obtenu, r.attendu, `mauvaise cible après défilement (obtenu : ${r.lisible})`);
});

test("liaison : cible correcte après un déplacement de nœud", "complexe", async p => {
  const r = await p(`
    const bouge = one('Lentilles sèches');
    await selectNode(bouge.id);
    await dragNode(bouge.id, 0, 1);          // descend d'une rangée
    const src = one('Tri, décorticage, conditionnement');
    const dst = one('Trempage, cuisson');
    await selectNode(src.id);
    const avant = links().length;
    await dragLink('out', dst.id);
    const nouveau = links()[links().length - 1];
    return { creees: links().length - avant, obtenu: nouveau.source + '->' + nouveau.target,
             attendu: src.id + '->' + dst.id, lisible: desc(nouveau) };
  `);
  egal(r.creees, 1, "un lien doit être créé");
  egal(r.obtenu, r.attendu, `mauvaise cible après déplacement (obtenu : ${r.lisible})`);
});

test("liaison : relâcher hors d'un nœud ne crée rien", "complexe", async p => {
  const r = await p(`
    const src = one('Féverolle');
    await selectNode(src.id);
    const avant = links().length;
    const c = canvasRect();
    await dragLink('out', null, { point: { x: c.left + 60, y: c.top + 420 } });
    return { creees: links().length - avant };
  `);
  egal(r.creees, 0, "aucun lien ne doit être créé sur un relâchement dans le vide");
});

test("sélection : un clic suffit pour passer d'un nœud à l'autre", "complexe", async p => {
  const r = await p(`
    const suite = ['Féverolle', 'Tri, décorticage, conditionnement', 'Lentilles sèches',
                   'Trempage, cuisson', 'GMS Bretagne', 'Féverolle'];
    const obtenu = [];
    for (const nom of suite) {
      const n = one(nom);
      const sel = await selectNode(n.id);
      obtenu.push(sel.id === n.id ? 'ok' : 'ÉCHEC(' + nom + ' -> ' + sel.id + ')');
    }
    return { obtenu };
  `);
  egal(r.obtenu.filter(x => x !== "ok"), [], "chaque clic doit sélectionner le nœud cliqué");
});

test("sélection : reste fiable après une série d'actions", "complexe", async p => {
  const r = await p(`
    const etapes = [];
    // 1. ajout par le +
    const a = one('Féverolle');
    await selectNode(a.id);
    await clickPlus();
    // 2. liaison
    const src = one('Tri, décorticage, conditionnement');
    await selectNode(src.id);
    await dragLink('out', one('Trempage, cuisson').id);
    // 3. déplacement
    await selectNode(one('Lentilles sèches').id);
    await dragNode(one('Lentilles sèches').id, 0, 1);
    // 4. changement de filière
    await selectNode(one('GMS Bretagne').id);
    await setField('Filière', 'Débouchés');
    // puis on vérifie que la sélection suit toujours le clic
    for (const nom of ['Féverolle', 'Trempage, cuisson', 'Lentilles sèches', 'GMS Bretagne']) {
      const n = one(nom);
      const sel = await selectNode(n.id);
      etapes.push(sel.id === n.id ? 'ok' : 'ÉCHEC(' + nom + ')');
    }
    return { etapes };
  `);
  egal(r.etapes.filter(x => x !== "ok"), [], "la sélection doit rester fiable après une série d'actions");
});

test("déplacement : change la colonne et renumérote l'ordre", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    const colAvant = byId(n.id).column;
    await dragNode(n.id, 1, 0);
    return { colAvant, colApres: byId(n.id).column };
  `);
  egal(r.colApres, r.colAvant + 1, "le nœud doit changer de colonne");
});

test("déplacement : ne casse pas l'ordre des nœuds d'une filière masquée", "complexe", async p => {
  const r = await p(`
    const masques = () => nodes().filter(n => n.filiere === 'Blé tendre')
        .map(n => n.id + ':c' + n.column + ':o' + n.order).sort();
    const avant = masques();
    const n = one('Féverolle');
    await selectNode(n.id);
    await dragNode(n.id, 0, 2);
    return { avant, apres: masques() };
  `);
  egal(r.apres, r.avant, "déplacer un nœud visible ne doit pas modifier les nœuds masqués");
});

test("suppression : retire le nœud et tous ses liens", "complexe", async p => {
  const r = await p(`
    const n = one('Lentilles sèches');
    const attaches = links().filter(l => l.source === n.id || l.target === n.id).length;
    await selectNode(n.id);
    const bouton = [...document.querySelectorAll('#sidebar button.danger')][0];
    bouton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    return {
      attaches,
      noeudRestant: !!byId(n.id),
      liensOrphelins: links().filter(l => l.source === n.id || l.target === n.id).length
    };
  `);
  attendu(r.attaches > 0, "le nœud choisi doit avoir des liens");
  attendu(!r.noeudRestant, "le nœud doit être supprimé");
  egal(r.liensOrphelins, 0, "aucun lien orphelin ne doit subsister");
});

test("renommage : double-clic sur un nœud", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    elOf(n.id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(60);
    const champ = document.querySelector('.inline-edit');
    const prerempli = champ.value;
    champ.value = 'Féverole';
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(120);
    return { prerempli, apres: byId(n.id).name };
  `);
  egal(r.prerempli, "Féverolle", "le champ doit être prérempli avec le nom courant");
  egal(r.apres, "Féverole", "le nouveau nom doit être enregistré");
});

test("renommage : intitulé de colonne appliqué à tous ses nœuds", "complexe", async p => {
  const r = await p(`
    const labels = [...document.querySelectorAll('#canvas .grid-col-label')];
    labels[3].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(60);
    const champ = document.querySelector('.inline-edit');
    champ.value = 'Produits secs';
    champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(120);
    const col4 = nodes().filter(n => n.column === 4);
    return {
      total: col4.length,
      avecTitre: col4.filter(n => n.title === 'Produits secs').length,
      noms: col4.map(n => n.name)
    };
  `);
  egal(r.avecTitre, r.total,
    `tous les nœuds de la colonne doivent porter l'intitulé (${r.noms.join(", ")})`);
});

test("annulation : Cmd+Z rétablit l'état précédent", "complexe", async p => {
  const r = await p(`
    const src = one('Féverolle');
    await selectNode(src.id);
    const avant = links().length;
    await dragLink('out', one('Lentilles sèches').id);
    const apresLien = links().length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await sleep(140);
    return { avant, apresLien, apresAnnulation: links().length };
  `);
  egal(r.apresLien, r.avant + 1, "le lien doit d'abord être créé");
  egal(r.apresAnnulation, r.avant, "l'annulation doit retirer le lien");
});

test("identifiants : restent uniques même avec un compteur périmé", "compteurPerime", async p => {
  const r = await p(`
    const src = one('Féverolle');
    await selectNode(src.id);
    await clickPlus();
    await selectNode(one('Trempage, cuisson').id);
    await clickPlus();
    const ids = nodes().map(n => n.id);
    const doublons = ids.filter((v, i) => ids.indexOf(v) !== i);
    const lids = links().map(l => l.id);
    return { doublons, doublonsLiens: lids.filter((v, i) => lids.indexOf(v) !== i) };
  `);
  egal(r.doublons, [], "aucun identifiant de nœud ne doit être attribué deux fois");
  egal(r.doublonsLiens, [], "aucun identifiant de lien ne doit être attribué deux fois");
});

test("identifiants : le nœud créé est bien celui qui est relié", "compteurPerime", async p => {
  const r = await p(`
    const src = one('Féverolle');
    await selectNode(src.id);
    const avant = new Set(nodes().map(n => n.id));
    await clickPlus();
    const cree = nodes().find(n => !avant.has(n.id)) || nodes()[nodes().length - 1];
    const lien = links()[links().length - 1];
    return {
      idCree: cree.id,
      colonneCreee: cree.column,
      colonneSource: src.column,
      lien: lien.source + '->' + lien.target,
      attendu: src.id + '->' + cree.id,
      cibleLisible: desc(lien),
      nomCree: cree.name
    };
  `);
  egal(r.colonneCreee, r.colonneSource + 1, "le nœud créé doit être dans la colonne de droite");
  egal(r.lien, r.attendu,
    `le lien doit viser le nœud créé, pas un homonyme d'identifiant (obtenu : ${r.cibleLisible})`);
});

test("identifiants : lier après ajout vise le bon nœud", "compteurPerime", async p => {
  const r = await p(`
    // On ajoute un nœud (qui prend un identifiant déjà pris si le compteur est périmé),
    // puis on tire un lien vers « Lentilles sèches ».
    await selectNode(one('Féverolle').id);
    await clickPlus();
    const src = one('Production végétale, collecte, stockage');
    const dst = one('Lentilles sèches');
    await selectNode(src.id);
    const d = await dragLink('out', dst.id);
    const lien = links()[links().length - 1];
    return {
      obtenu: lien.source + '->' + lien.target,
      attendu: src.id + '->' + dst.id,
      lisible: desc(lien),
      surligne: d.highlighted,
      cible: dst.id
    };
  `);
  egal(r.surligne, r.cible, "le nœud surligné doit être la cible visée");
  egal(r.obtenu, r.attendu, `le lien doit relier les nœuds visés (obtenu : ${r.lisible})`);
});

test("App→Excel : prévient par une modale quand le classeur est ouvert", "complexe", async (p, excel) => {
  excel.verrou = true;
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    await sleep(80);
    const bouton = [...document.querySelectorAll('#sidebar button')]
        .find(b => /App\\s*→\\s*Excel/.test(b.textContent));
    if (!bouton) throw new Error('bouton « App → Excel » introuvable');
    bouton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(400);
    const modale = document.querySelector('.ov-modal');
    const texte = modale ? modale.textContent : '';
    if (modale) {
      [...modale.querySelectorAll('.ov-btn')].find(b => /Annuler/.test(b.textContent))
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await sleep(200);
    return {
      modaleAffichee: !!modale,
      titre: modale ? modale.querySelector('.ov-title').textContent : null,
      parleDEcriture: /y écrire/.test(texte),
      statut: document.getElementById('status').textContent
    };
  `);
  attendu(r.modaleAffichee, "une modale doit prévenir que le classeur est ouvert");
  egal(r.titre, "Le classeur est ouvert dans Excel", "titre de la modale");
  attendu(r.parleDEcriture, "le message doit parler d'écriture, pas d'édition des nœuds");
  attendu(/différée/.test(r.statut), "le statut doit indiquer que l'écriture est différée");
  egal(excel.ecritures, 0, "aucune écriture ne doit être tentée tant que le classeur est ouvert");
});

test("App→Excel : écrit sans modale quand le classeur est fermé", "complexe", async (p, excel) => {
  excel.verrou = false;
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    await sleep(80);
    [...document.querySelectorAll('#sidebar button')]
        .find(b => /App\\s*→\\s*Excel/.test(b.textContent))
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(400);
    return { modale: !!document.querySelector('.ov-modal'),
             statut: document.getElementById('status').textContent };
  `);
  attendu(!r.modale, "aucune modale ne doit s'afficher si le classeur est fermé");
  egal(excel.ecritures, 1, "l'écriture doit être tentée une seule fois");
});

test("App→Excel : ferme Excel tout seul si l'option est active", "complexe", async (p, excel) => {
  excel.verrou = true;
  const r = await p(`
    T.prefs().autoCloseExcel = true;
    T.setExcelPath('/tmp/classeur-test.xlsx');
    await sleep(80);
    [...document.querySelectorAll('#sidebar button')]
        .find(b => /App\\s*→\\s*Excel/.test(b.textContent))
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(600);
    const res = { modale: !!document.querySelector('.ov-modal'),
                  statut: document.getElementById('status').textContent };
    T.prefs().autoCloseExcel = false;
    return res;
  `);
  attendu(!r.modale, "en mode automatique, aucune modale ne doit s'afficher");
  egal(excel.fermetures, 1, "Excel doit avoir été fermé une fois");
  egal(excel.ecritures, 1, "l'écriture doit avoir lieu après la fermeture");
});

/* -------------------------------- exécution ------------------------------ */

async function charger(win, fixture) {
  // Un test peut laisser un éditeur en ligne ou une surcouche ouverts : on
  // repart d'une page propre, sinon le test suivant tombe dessus.
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.inline-edit, .ov-backdrop, .cp-backdrop').forEach(e => e.remove()); true`
  );
  await win.webContents.executeJavaScript(
    `window.__sankeyTest.loadProject(${JSON.stringify(FIXTURES[fixture])}); true`
  );
  await new Promise(r => setTimeout(r, 250));
}

// État d'Excel simulé, piloté par les tests via le 2e argument de test().
const excelSimule = { verrou: false, fermetures: 0, ecritures: 0 };
function stubExcelIpc() {
  ipcMain.handle("excel:isLocked", () => ({ locked: excelSimule.verrou, exists: true, mode: "excel" }));
  ipcMain.handle("excel:watch", () => ({ ok: true, locked: excelSimule.verrou }));
  ipcMain.handle("excel:read", () => ({ ok: false, error: "bouchon" }));
  ipcMain.handle("excel:write", () => {
    excelSimule.ecritures++;
    return excelSimule.verrou
      ? { ok: false, error: "Classeur ouvert dans Excel", locked: true }
      : { ok: true, path: "/tmp/bouchon.xlsx", sheetName: "Diagramme" };
  });
  ipcMain.handle("excel:closeInExcel", () => {
    excelSimule.fermetures++;
    excelSimule.verrou = false;
    return { ok: true, state: "closed", locked: false };
  });
}

app.whenReady().then(async () => {
  stubExcelIpc();
  const win = new BrowserWindow({
    width: 1000, height: 620, show: false,
    webPreferences: {
      preload: path.join(ROOT, "src/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await win.loadFile(path.join(ROOT, "dist/renderer/index.html"));
  await win.webContents.executeJavaScript("localStorage.clear()");
  await new Promise(r => setTimeout(r, 600));

  const page = expr => win.webContents.executeJavaScript(
    `(async () => { ${HELPERS}\n${expr} })()`
  );

  let ok = 0;
  const echecs = [];
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    try {
      excelSimule.verrou = false;
      excelSimule.fermetures = 0;
      excelSimule.ecritures = 0;
      await charger(win, t.fixture);
      await t.fn(page, excelSimule);
      console.log("  ok    " + t.name);
      ok++;
    } catch (e) {
      const detail = e instanceof Echec ? e.message : (e && e.message) || String(e);
      console.log("  ÉCHEC " + t.name + "\n      " + detail);
      echecs.push(t.name);
    }
  }

  console.log(`\n${ok}/${ok + echecs.length} tests passés`);
  if (echecs.length) console.log("Échecs :\n  - " + echecs.join("\n  - "));
  app.exit(echecs.length ? 1 : 0);
});
