/**
 * Tests des fonctionnalités d'édition de Sankey Studio.
 *
 * Chaque test charge un diagramme dans une fenêtre Electron masquée puis pilote
 * l'éditeur par de vrais évènements souris/clavier. Electron n'est PAS le
 * produit — Sankey Studio est un complément Excel : c'est ici un simple
 * navigateur pilotable, le seul qui permette de vraies frappes et de vrais
 * glissers. Le pont posé devant l'éditeur est `tests/pont-essai.js`, qui
 * déclare les mêmes capacités que le volet.
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

test("synchro automatique : une modification part seule dans le classeur", "complexe", async (p, excel) => {
  excel.ecritures = 0;
  await p(`
    // L'amorce (lecture du classeur) est un bouchon en échec dans ce banc :
    // sans elle, rien ne part vers Excel — c'est le garde-fou qui évite
    // d'écraser les tableaux avec un modèle vide. On la déclare faite.
    T.amorce(true);
    const src = one('Féverolle');
    await selectNode(src.id);
    await clickPlus();
    await sleep(600); // au-delà du délai d'apaisement (300 ms)
    T.amorce(false);
    return true;
  `);
  attendu(excel.ecritures >= 1,
    "la modification doit partir d'elle-même dans le classeur — écritures : " + excel.ecritures);
});

test("alerte : un remplissage d'Excel est montré, et pas seulement corrigé", "complexe", async (p, excel) => {
  // Le complément DÉFAIT la recopie d'Excel, mais il ne peut pas rendre les
  // valeurs qu'elle a écrasées. Se taire, c'est laisser l'utilisatrice croire
  // que sa colonne est intacte — et laisser passer la fenêtre pendant laquelle
  // une version antérieure du classeur est encore restaurable.
  excel.remplissage = { formule: "='Blé tendre'!$C$8", liens: 130 };
  try {
    const r = await p(`
      T.amorce(true);
      const src = one('Féverolle');
      await selectNode(src.id);
      await clickPlus();
      await sleep(600);            // au-delà du délai d'apaisement (300 ms)
      T.amorce(false);
      const carte = [...document.querySelectorAll('#sidebar .panel')]
          .find(e => e.querySelector('h3') && e.querySelector('h3').textContent.includes('écrasées'));
      const texte = carte ? carte.textContent : '';
      const bouton = carte && carte.querySelector('button.linklike');
      if (bouton) bouton.click();
      await sleep(60);
      const apres = [...document.querySelectorAll('#sidebar .panel')]
          .some(e => e.querySelector('h3') && e.querySelector('h3').textContent.includes('écrasées'));
      return { montre: !!carte, formule: texte.includes("='Blé tendre'!$C$8"),
               liens: texte.includes('130 liens'), restePresente: apres };
    `);
    attendu(r.montre, "le panneau doit porter une carte d'alerte après l'écriture");
    attendu(r.formule, "l'alerte doit nommer la formule recopiée");
    attendu(r.liens, "l'alerte doit dire combien de liens elle occupait");
    attendu(!r.restePresente, "l'alerte doit disparaître une fois écartée");
  } finally {
    excel.remplissage = null;
  }
});

test("couloirs : le couloir 2 se range sous le couloir 1", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.filter(n => n.column >= 4).forEach(n => { n.lane = 2; });
    T.refresh();
    await sleep(120);
    const visibles = nodes().filter(n => !T.hidden().includes(n.filiere));
    const bas1 = Math.max(...visibles.filter(n => n.lane === 1).map(n => boxOf(n.id).bottom));
    const haut2 = Math.min(...visibles.filter(n => n.lane === 2).map(n => boxOf(n.id).top));
    const separateurs = document.querySelectorAll('#canvas .grid-lane-line').length;
    // textContent inclurait l'infobulle <title> : on ne lit que le nœud texte.
    const libelles = [...document.querySelectorAll('#canvas .grid-lane-label')]
        .map(t => t.childNodes[0].nodeValue);
    return { bas1, haut2, separateurs, libelles };
  `);
  attendu(r.haut2 > r.bas1,
    `tout le couloir 2 doit être sous le couloir 1 (bas du 1 : ${Math.round(r.bas1)}, haut du 2 : ${Math.round(r.haut2)})`);
  egal(r.separateurs, 2, "un séparateur par couloir");
  egal(r.libelles, ["Couloir 1", "Couloir 2"], "les couloirs sont nommés par défaut");
});

test("couloirs : un seul couloir ne change rien à la mise en page", "complexe", async p => {
  const r = await p(`
    const avant = nodes().filter(n => !T.hidden().includes(n.filiere))
        .map(n => Math.round(boxOf(n.id).top));
    const m = T.model();
    m.nodes.forEach(n => { n.lane = 1; });
    T.refresh();
    await sleep(120);
    const apres = nodes().filter(n => !T.hidden().includes(n.filiere))
        .map(n => Math.round(boxOf(n.id).top));
    return { avant, apres, separateurs: document.querySelectorAll('#canvas .grid-lane-line').length };
  `);
  egal(r.apres, r.avant, "les ordonnées ne bougent pas");
  egal(r.separateurs, 0, "aucun décor de couloir quand il n'y en a qu'un");
});

test("couloirs : glisser un nœud dans la bande du dessous change son couloir", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.filter(n => n.column >= 4).forEach(n => { n.lane = 2; });
    T.refresh();
    await sleep(120);
    const visible = n => !T.hidden().includes(n.filiere);
    const cible = nodes().find(n => n.lane === 1 && visible(n));
    const bandeur2 = nodes().filter(n => n.lane === 2 && visible(n)).map(n => boxOf(n.id));
    const haut2 = Math.min(...bandeur2.map(b => b.top));
    const bas2 = Math.max(...bandeur2.map(b => b.bottom));
    const depart = boxOf(cible.id);
    // On vise le MILIEU de la bande : c'est le centre du nœud qui décide du couloir.
    const dy = (haut2 + bas2) / 2 - (depart.top + depart.height / 2);
    await dragNodePx(cible.id, 0, dy);
    await sleep(150);
    return { couloir: byId(cible.id).lane, nom: cible.name };
  `);
  egal(r.couloir, 2, `« ${r.nom} » doit avoir rejoint le couloir 2`);
});

test("couloirs : le champ « Couloir » déplace le nœud", "complexe", async p => {
  const r = await p(`
    const cible = nodes().find(n => !T.hidden().includes(n.filiere));
    await selectNode(cible.id);
    await setField('Couloir', '3');
    await sleep(150);
    return { couloir: byId(cible.id).lane, autres: nodes().filter(n => n.lane === 3).length };
  `);
  egal(r.couloir, 3, "le champ doit fixer le couloir du nœud");
  egal(r.autres, 1, "un seul nœud a changé de couloir");
});

test("couloirs (aperçu) : les nœuds d'un couloir restent dans leur bande", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.forEach(n => { n.lane = n.column >= 4 ? 2 : 1; });
    T.refresh();
    await sleep(120);
    const lane2 = new Set(m.nodes.filter(n => n.lane === 2).map(n => n.id));
    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(300);
    // Les rectangles de nœud portent le data-id de leur nœud.
    const rects = [...document.querySelectorAll('#canvas rect[data-id]')]
      .map(rc => ({ id: rc.getAttribute('data-id'),
                    haut: rc.getBoundingClientRect().top,
                    bas: rc.getBoundingClientRect().bottom }));
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
    const l1 = rects.filter(x => !lane2.has(x.id));
    const l2 = rects.filter(x => lane2.has(x.id));
    return { n1: l1.length, n2: l2.length,
             bas1: Math.max(...l1.map(x => x.bas)), haut2: Math.min(...l2.map(x => x.haut)) };
  `);
  attendu(r.n1 > 0 && r.n2 > 0, `les deux couloirs doivent être peints (${r.n1} / ${r.n2})`);
  attendu(r.haut2 > r.bas1,
    `le couloir 2 doit être entièrement sous le couloir 1 (${Math.round(r.bas1)} -> ${Math.round(r.haut2)})`);
});

test("couloirs (aperçu) : un flux venant d'en haut arrive en haut du nœud", "complexe", async p => {
  const r = await p(`
    // Cas signalé sur « Flux légumineuses » : le nœud du couloir DU DESSUS porte
    // un ordre vertical PLUS GRAND que celui du couloir du dessous. Empiler les
    // rubans selon l'ordre les faisait se croiser ; il faut les empiler selon la
    // position réellement peinte du nœud d'en face.
    const n = (id, name, column, order, lane, color) =>
      ({ id, name, column, title: '', order, lane, filiere: '', color, x: 0, y: 0 });
    T.loadProject({ version: 1, idCounter: 20, model: {
      nodes: [
        n('a', 'Importation', 1, 5, 1, '#999999'),
        n('b', 'Production', 1, 0, 2, '#adcb47'),
        n('c', 'Collecte', 2, 0, 2, '#e79a3c')
      ],
      links: [
        { id: 'l1', source: 'a', target: 'c', value: 10, unit: 't' },
        { id: 'l2', source: 'b', target: 'c', value: 90, unit: 't' }
      ]
    }});
    await sleep(150);
    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(350);
    const y = id => Math.round(parseFloat(
      document.querySelector('#canvas rect[data-id="' + id + '"]').getAttribute('y')));
    // Le « d » du ruban commence au bord du nœud d'origine et rejoint le nœud
    // d'arrivée juste avant le « L » : on y lit les deux bords hauts.
    const ruban = src => {
      const d = document.querySelector(
        '#canvas path[data-source="' + src + '"][data-target="c"]').getAttribute('d');
      return {
        depart: Math.round(+d.match(/^M[-\\d.]+,([-\\d.]+)/)[1]),
        arrivee: Math.round(+d.match(/C[^C]*?\\s[-\\d.]+,([-\\d.]+)\\s*L/)[1])
      };
    };
    const res = { noeudHaut: y('a'), noeudBas: y('b'), a: ruban('a'), b: ruban('b') };
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
    return res;
  `);
  attendu(r.noeudHaut < r.noeudBas,
    `« Importation » (couloir 1) doit être peint au-dessus de « Production » (couloir 2) — ` +
    `${r.noeudHaut} / ${r.noeudBas}`);
  attendu(r.a.arrivee < r.b.arrivee,
    `le flux venu d'en haut doit arriver au-dessus de l'autre — ` +
    `arrivées : haut ${r.a.arrivee}, bas ${r.b.arrivee}`);
});

test("couloirs (aperçu) : nommer les couloirs leur réserve une marge à gauche", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.forEach(n => { n.lane = n.column >= 4 ? 2 : 1; });
    T.refresh();
    await sleep(120);
    const abscisse = async () => {
      document.querySelectorAll('#toolbar .segmented .seg')[1].click();
      await sleep(300);
      const x = Math.min(...[...document.querySelectorAll('#canvas rect[data-id]')]
        .map(rc => parseFloat(rc.getAttribute('x'))));
      const noms = [...document.querySelectorAll('#canvas text')]
        .map(t => t.textContent).filter(t => /périmètre/i.test(t));
      document.querySelectorAll('#toolbar .segmented .seg')[0].click();
      await sleep(150);
      return { x, noms };
    };
    const sansNom = await abscisse();
    const carte = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Couloirs/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(60);
    const saisir = (libelle, valeur) => {
      const f = [...carte.querySelectorAll('.field')]
        .find(x => x.textContent.trim().startsWith(libelle));
      const i = f.querySelector('input');
      i.focus(); i.value = valeur;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    };
    saisir('Couloir 1', 'Amont hors périmètre');
    saisir('Couloir 2', 'Aval hors périmètre');
    await sleep(150);
    const avecNom = await abscisse();
    return { sansNom, avecNom };
  `);
  attendu(r.avecNom.x > r.sansNom.x + 20,
    `les noms doivent décaler le diagramme vers la droite (${Math.round(r.sansNom.x)} -> ${Math.round(r.avecNom.x)})`);
  egal(r.sansNom.noms, [], "sans nom saisi, rien n'est écrit");
  egal(r.avecNom.noms.sort(), ["Amont hors périmètre", "Aval hors périmètre"],
    "les deux noms sont peints");
});

test("traversée : un lien qui saute une colonne ne passe pas sur le nœud traversé",
    "complexe", async p => {
  const r = await p(`
    // Le cas signalé : A en colonne 4, B en 5, C en 6, avec les liens A→B, B→C
    // ET A→C. Sans place réservée, le ruban A→C passe sur B.
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    const m = T.model();
    const a = one('Farine');                                // colonne 4
    const b = one('Distribution');                          // colonne 5
    const c = one('Exportation de produits transformés');   // colonne 6
    m.links.push({ id: 'saut', source: a.id, target: c.id, value: 400 });
    T.refresh();
    await sleep(120);

    await versApercu();
    const passage = noeudsRecouverts(a.id, c.id).map(id => byId(id).name);
    await versEdition();
    await reglerCarte('Liens', 'Colonnes sautées', 'direct');
    await versApercu();
    const direct = noeudsRecouverts(a.id, c.id).map(id => byId(id).name);
    await versEdition();
    return { passage, direct, traversee: b.name, saut: c.column - a.column };
  `);
  egal(r.saut, 2, "le lien mis à l'épreuve doit bien sauter une colonne");
  egal(r.passage, [], "avec une place réservée, le ruban ne recouvre plus aucun nœud");
  egal(r.direct, [r.traversee],
    "tracé tout droit, le même ruban recouvre le nœud traversé — sans quoi le test ne prouverait rien");
});

test("traversée : un lien qui saute deux colonnes se faufile dans chacune", "complexe", async p => {
  const r = await p(`
    // Cas a-b-c-d doublé d'un raccourci a-d : le ruban traverse DEUX colonnes.
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    const m = T.model();
    const a = one('Blé tendre bio');   // colonne 2
    const d = one('Distribution');     // colonne 5
    m.links.push({ id: 'raccourci', source: a.id, target: d.id, value: 300 });
    T.refresh();
    await sleep(120);
    await versApercu();
    const recouverts = noeudsRecouverts(a.id, d.id).map(id => byId(id).name);
    const rubans = document.querySelectorAll('#canvas path[data-source]').length;
    await versEdition();
    return { recouverts, rubans, liens: m.links.length, colonnes: d.column - a.column };
  `);
  egal(r.colonnes, 3, "le raccourci doit bien sauter deux colonnes");
  egal(r.recouverts, [], "le ruban ne recouvre aucun nœud des deux colonnes traversées");
  egal(r.rubans, r.liens,
    "un ruban par lien : les places réservées ne doivent pas peindre de morceaux en plus");
});

test("filières empilées : la même colonne tombe à la même abscisse", "complexe", async p => {
  const r = await p(`
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    // On raccourcit une filière : sans grille commune, chacune étalerait ses
    // propres colonnes sur toute la largeur.
    const m = T.model();
    const trop = m.nodes.filter(n => n.filiere === 'Lentilles' && n.column >= 5).map(n => n.id);
    m.nodes = m.nodes.filter(n => !trop.includes(n.id));
    m.links = m.links.filter(l => !trop.includes(l.source) && !trop.includes(l.target));
    T.refresh();
    await sleep(120);

    const carte = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(60);
    [...carte.querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input').click();
    await sleep(200);

    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(350);
    const blocs = [...document.querySelectorAll('#canvas > g[transform^="translate(0,"]')];
    const abscisses = blocs.map(b => [...b.querySelectorAll('rect[data-id]')]
        .map(rc => Math.round(parseFloat(rc.getAttribute('x'))))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b));
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
    return { nbBlocs: blocs.length, abscisses };
  `);
  egal(r.nbBlocs, 2, "un bloc par filière");
  const [a, b] = r.abscisses;
  attendu(a.length !== b.length,
    `les deux filières doivent avoir un nombre de colonnes différent (${a.length} / ${b.length})`);
  const court = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  const alignees = court.every(x => long.some(y => Math.abs(x - y) <= 1));
  attendu(alignees,
    `chaque colonne du bloc court doit tomber sur une colonne du bloc long\n` +
    `      court : ${JSON.stringify(court)}\n      long  : ${JSON.stringify(long)}`);
});

// La colonne « Type » du classeur (« Industrie » en clair) est éprouvée là où
// elle s'écrit : buildModelRows, dans tests/addin-office.test.js. Ici on ne
// vérifie que ce qui appartient à l'éditeur — le champ change bien le nœud.
test("types : le champ « Type » change la nature du nœud", "complexe", async p => {
  const r = await p(`
    const cible = nodes().find(n => !T.hidden().includes(n.filiere));
    await selectNode(cible.id);
    await setField('Type', 'industrie');
    await sleep(150);
    return {
      kind: byId(cible.id).kind,
      industries: nodes().filter(n => n.kind === 'industrie').length
    };
  `);
  egal(r.kind, "industrie", "le champ doit fixer le type du nœud");
  egal(r.industries, 1, "un seul nœud a changé de type");
});

test("types : un nouveau nœud est toujours un produit", "complexe", async p => {
  // Le type par défaut ne doit dépendre d'AUCUN contexte. Il reprenait celui du
  // nœud sélectionné : partir d'une industrie en créait une autre, en silence,
  // et rien à l'écran ne disait pourquoi.
  const r = await p(`
    const cible = nodes().find(n => !T.hidden().includes(n.filiere));
    await selectNode(cible.id);
    await setField('Type', 'industrie');
    await sleep(150);

    const avant = nodes().map(n => n.id);
    document.querySelector('#toolbar button').click();   // ＋ Nœud
    await sleep(200);
    const parLeBouton = nodes().find(n => !avant.includes(n.id));

    // Deuxième chemin : le « + » du nœud sélectionné, qui crée un nœud DÉJÀ RELIÉ.
    await selectNode(cible.id);
    const avant2 = nodes().map(n => n.id);
    await clickPlus();
    document.querySelector('.inline-edit') && document.querySelector('.inline-edit').blur();
    await sleep(200);
    const parLePlus = nodes().find(n => !avant2.includes(n.id));

    return {
      source: byId(cible.id).kind,
      bouton: parLeBouton && parLeBouton.kind,
      plus: parLePlus && parLePlus.kind
    };
  `);
  egal(r.source, "industrie", "le nœud de départ est bien une industrie");
  egal(r.bouton, "produit", "« ＋ Nœud » crée un produit, même depuis une industrie");
  egal(r.plus, "produit", "le « + » du nœud crée un produit lui aussi");
});

test("panneau : la carte « Nœuds » réunit la boîte et son étiquette", "complexe", async p => {
  // Les deux cartes réglaient un seul objet. Fusionnées, aucun réglage ne doit
  // avoir disparu au passage — c'est ce que ce test compte.
  const r = await p(`
    const titres = [...document.querySelectorAll('#sidebar details summary')]
      .map(s => s.textContent.trim());
    const c = await carteDuPanneau('Nœuds');
    const labels = [...c.querySelectorAll('.field')]
      .map(f => (f.querySelector('span') || f).textContent.trim());
    return { titres, labels };
  `);
  egal(r.titres.filter(t => t.indexOf("Étiquettes des nœuds") >= 0).length, 0,
       "il n'y a plus de carte « Étiquettes des nœuds » séparée");
  egal(r.titres.filter(t => t.indexOf("Nœuds") >= 0).length, 1,
       "une seule carte « Nœuds »");
  // Les réglages des deux anciennes cartes, tous présents dans la nouvelle.
  [
    "Couleur par défaut", "Largeur des nœuds", "Espacement vertical",
    "Afficher l'étiquette", "Position", "Afficher la valeur",
    "Arrière-plan", "Couleur d'arrière-plan", "Opacité de l'arrière-plan (%)",
    "Retour à la ligne", "Longueur max. par ligne"
  ].forEach(l => {
    if (!r.labels.some(x => x.indexOf(l) >= 0)) {
      throw new Error("réglage perdu à la fusion : « " + l + " »\n      présents : "
                      + JSON.stringify(r.labels));
    }
  });
});

test("types : sans réglage propre, la mise en page ne bouge pas d'un pixel", "complexe", async p => {
  const r = await p(`
    const releve = () => rectsApercu()
      .map(x => ({ id: x.id, g: Math.round(x.gauche * 100), l: Math.round(x.largeur * 100),
                   h: Math.round(x.haut * 100) }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    await versApercu();
    const avant = releve();
    await versEdition();
    const m = T.model();
    m.nodes.forEach((n, i) => { n.kind = i % 2 ? 'industrie' : 'produit'; });
    T.refresh();
    await sleep(120);
    await versApercu();
    const apres = releve();
    await versEdition();
    return { avant, apres };
  `);
  attendu(r.avant.length > 0, "l'aperçu doit peindre des nœuds");
  egal(r.apres, r.avant, "typer les nœuds sans rien régler ne doit rien déplacer");
});

test("types (aperçu) : chaque type reçoit sa largeur, centrée sur l'axe de sa colonne", "complexe", async p => {
  const r = await p(`
    // Un produit et une industrie dans la MÊME colonne : c'est là que se voit
    // le centrage, un nœud sans boîte devant rester sur l'axe de sa colonne.
    const m = T.model();
    const visibles = m.nodes.filter(n => !T.hidden().includes(n.filiere));
    const parColonne = {};
    visibles.forEach(n => { (parColonne[n.column] = parColonne[n.column] || []).push(n); });
    const chargee = Object.keys(parColonne).map(c => parColonne[c])
      .sort((a, b) => b.length - a.length)[0];
    if (chargee.length < 2) throw new Error('aucune colonne ne porte deux nœuds visibles');
    m.nodes.forEach(n => { n.kind = 'industrie'; });
    chargee[0].kind = 'produit';
    T.refresh();
    await sleep(120);
    await cocher('Produits / commodités', 'Largeur propre à ce type');
    await reglerCarte('Produits / commodités', 'Largeur', '0');
    await cocher('Industries / étapes', 'Largeur propre à ce type');
    await reglerCarte('Industries / étapes', 'Largeur', '40');
    await versApercu();
    const rects = rectsApercu();
    await versEdition();
    const axe = x => (x.gauche + x.droite) / 2;
    const largeurs = k => [...new Set(rects.filter(x => x.kind === k).map(x => Math.round(x.largeur)))];
    const produit = rects.find(x => x.id === chargee[0].id);
    const voisin = rects.find(x => x.id === chargee[1].id);
    return {
      produits: largeurs('produit'),
      industries: largeurs('industrie'),
      derive: produit && voisin ? Math.abs(axe(produit) - axe(voisin)) : null,
      peints: rects.length
    };
  `);
  egal(r.produits, [0], "un produit est réduit à un trait");
  egal(r.industries, [40], "les industries prennent la largeur demandée");
  attendu(r.derive !== null && r.derive < 0.6,
    `le produit sans boîte reste sur l'axe de sa colonne (écart : ${r.derive})`);
});

test("types (aperçu) : le contour entoure le nœud à l'écart demandé", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.forEach(n => { n.kind = 'industrie'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Contour');
    await reglerCarte('Industries / étapes', 'Écart au nœud', '6');
    await reglerCarte('Industries / étapes', 'Épaisseur du contour', '2');
    await reglerCarte('Industries / étapes', 'Arrondi', '3');
    await versApercu();
    const rc = document.querySelector('#canvas rect[data-id]');
    const id = rc.getAttribute('data-id');
    const co = document.querySelector('#canvas rect[data-outline-for="' + id + '"]');
    const nb = document.querySelectorAll('#canvas rect[data-outline-for]').length;
    const nbNoeuds = document.querySelectorAll('#canvas rect[data-id]').length;
    const num = (el, a) => parseFloat(el.getAttribute(a));
    const res = { contour: !!co, nb, nbNoeuds };
    if (co) {
      // Le trait est centré sur son tracé : l'écart VU vaut donc x - (écart + épaisseur/2).
      res.decalageGauche = Math.round((num(rc, 'x') - num(co, 'x')) * 100) / 100;
      res.decalageHaut = Math.round((num(rc, 'y') - num(co, 'y')) * 100) / 100;
      res.surLargeur = Math.round((num(co, 'width') - num(rc, 'width')) * 100) / 100;
      res.surHauteur = Math.round((num(co, 'height') - num(rc, 'height')) * 100) / 100;
      res.trait = num(co, 'stroke-width');
      res.arrondi = num(co, 'rx');
      res.couleurContour = co.getAttribute('stroke');
      res.couleurNoeud = rc.getAttribute('fill');
      res.remplissage = co.getAttribute('fill');
      // Peint pour de vrai : la boîte du contour déborde celle du nœud.
      const a = rc.getBoundingClientRect(), b = co.getBoundingClientRect();
      res.debordeVraiment = b.left < a.left && b.top < a.top && b.right > a.right && b.bottom > a.bottom;
    }
    await versEdition();
    return res;
  `);
  attendu(r.contour, "un contour doit être peint autour du nœud");
  egal(r.nb, r.nbNoeuds, "un contour par nœud du type concerné");
  egal(r.decalageGauche, 7, "écart 6 + demi-épaisseur 1 : le trait est centré sur son tracé");
  egal(r.decalageHaut, 7, "même écart en haut");
  egal(r.surLargeur, 14, "le contour est écarté des deux côtés");
  egal(r.surHauteur, 14, "idem verticalement");
  egal(r.trait, 2, "épaisseur du trait");
  egal(r.arrondi, 3, "arrondi des angles");
  egal(r.remplissage, "none", "un contour n'est qu'un liseré, jamais un aplat");
  attendu(r.couleurContour !== r.couleurNoeud,
    `le contour reprend la couleur du nœud en plus foncé (nœud ${r.couleurNoeud}, contour ${r.couleurContour})`);
  attendu(r.debordeVraiment, "le contour peint doit déborder le nœud de tous les côtés");
});

test("types (aperçu) : le contour n'est pas rogné par le bord du cadre", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.forEach(n => { n.kind = 'industrie'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Contour');
    await reglerCarte('Industries / étapes', 'Écart au nœud', '10');
    await reglerCarte('Industries / étapes', 'Épaisseur du contour', '4');
    await versApercu();
    const cadre = document.querySelector('#canvas').getBoundingClientRect();
    const co = [...document.querySelectorAll('#canvas rect[data-outline-for]')]
      .map(rc => rc.getBoundingClientRect());
    const res = {
      nb: co.length,
      gauche: Math.round(Math.min(...co.map(b => b.left)) - cadre.left),
      droite: Math.round(cadre.right - Math.max(...co.map(b => b.right))),
      bas: Math.round(cadre.bottom - Math.max(...co.map(b => b.bottom)))
    };
    await versEdition();
    return res;
  `);
  attendu(r.nb > 0, "des contours doivent être peints");
  attendu(r.gauche >= 0, `le contour de la 1re colonne reste dans le cadre (déborde de ${-r.gauche}px)`);
  attendu(r.droite >= 0, `celui de la dernière aussi (déborde de ${-r.droite}px)`);
  attendu(r.bas >= 0, `et celui du nœud le plus bas (déborde de ${-r.bas}px)`);
});

test("types (aperçu) : le contour peut être du noir transparent", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    m.nodes.forEach(n => { n.kind = 'industrie'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Contour');
    await reglerCarte('Industries / étapes', 'Couleur du contour', 'noir');
    await reglerCarte('Industries / étapes', 'Opacité du contour (%)', '30');
    await versApercu();
    const co = document.querySelector('#canvas rect[data-outline-for]');
    const res = { couleur: co && co.getAttribute('stroke'),
                  opacite: co && parseFloat(co.getAttribute('stroke-opacity')) };
    await versEdition();
    return res;
  `);
  egal(r.couleur, "#000000", "le mode « noir » dessine du noir");
  egal(r.opacite, 0.3, "l'opacité suit le réglage");
});

test("types (aperçu) : la mosaïque peint un damier blanc et couleur du nœud", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    // Une couleur franche, loin du blanc : les deux tons du damier se comptent
    // alors sans ambiguïté sur la peinture, lissage des bords compris.
    m.nodes.forEach(n => { n.kind = 'industrie'; n.color = '#c0392b'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Largeur propre à ce type');
    await reglerCarte('Industries / étapes', 'Largeur', '40');
    // D'abord SANS mosaïque : c'est le point de comparaison, sinon rien ne dit
    // que c'est bien l'option qui change la peinture.
    await versApercu();
    const rc = document.querySelector('#canvas rect[data-id]');
    const id = rc.getAttribute('data-id');
    const boite = a => parseFloat(rc.getAttribute(a));
    const avant = { fill: rc.getAttribute('fill'),
                    boite: [boite('x'), boite('y'), boite('width'), boite('height')],
                    mosaique: await mesurerMosaique(id, '#c0392b', 10) };
    await versEdition();
    await cocher('Industries / étapes', 'Mosaïque');
    await reglerCarte('Industries / étapes', "Côté d'un carré", '10');
    await versApercu();
    const rc2 = document.querySelector('#canvas rect[data-id="' + id + '"]');
    const boite2 = a => parseFloat(rc2.getAttribute(a));
    const fill = rc2.getAttribute('fill');
    // Pas d'expression régulière ici : dans un gabarit JS, « \\( » se replierait
    // en « ( » avant d'atteindre la page.
    const motif = fill.slice(0, 5) === 'url(#' && fill.slice(-1) === ')'
      ? document.getElementById(fill.slice(5, -1)) : null;
    const res = {
      avant: avant,
      fill: fill,
      motif: motif ? { balise: motif.tagName.toLowerCase(),
                       largeur: parseFloat(motif.getAttribute('width')),
                       hauteur: parseFloat(motif.getAttribute('height')),
                       unites: motif.getAttribute('patternUnits'),
                       dansDefs: motif.parentElement.tagName.toLowerCase() } : null,
      boite: [boite2('x'), boite2('y'), boite2('width'), boite2('height')],
      mosaique: await mesurerMosaique(id, '#c0392b', 10)
    };
    await versEdition();
    return res;
  `);
  egal(r.avant.mosaique.plages.length, 1,
    "sans mosaïque, le nœud est un aplat d'une seule couleur");
  egal(r.avant.mosaique.opposition, 0,
    "sans mosaïque, deux colonnes voisines portent le même ton");
  attendu(r.motif, `la mosaïque doit remplir le nœud par un motif (fill : ${r.fill})`);
  egal(r.motif.balise, "pattern", "le motif est un <pattern>");
  egal(r.motif.dansDefs, "defs", "le motif vit dans les <defs> du diagramme");
  egal(r.motif.unites, "userSpaceOnUse", "la tuile se mesure en pixels du dessin");
  egal(r.motif.largeur, 20, "une tuile porte deux carrés de 10 px de côté");
  egal(r.motif.hauteur, 20, "et autant en hauteur");
  egal(r.boite, r.avant.boite, "la mosaïque ne déplace ni ne redimensionne le nœud");
  // Ce que voit l'utilisatrice : une colonne de pixels au milieu du nœud
  // alterne du blanc et la couleur du nœud, par plages de 10 pixels.
  const c = r.mosaique;
  attendu(c.blancs > c.hauteur * 0.35 && c.couleurs > c.hauteur * 0.35,
    `les deux tons se partagent le nœud (blanc ${c.blancs}, couleur ${c.couleurs}, `
    + `autre ${c.autres}, sur ${c.hauteur} pixels)`);
  const tons = c.plages.filter(p => p.ton !== "autre").map(p => p.ton);
  attendu(tons.length >= 3 && tons.every((t, i) => i === 0 || t !== tons[i - 1]),
    `blanc et couleur alternent (plages : ${JSON.stringify(c.plages)})`);
  // Les plages du bord sont rognées par le haut et le bas du nœud : seules
  // celles du milieu portent la taille demandée.
  const milieu = c.plages.slice(1, -1).filter(p => p.ton !== "autre");
  attendu(milieu.length > 0 && milieu.every(p => p.n >= 8 && p.n <= 10),
    `chaque carré fait 10 px de haut (plages : ${JSON.stringify(c.plages)})`);
  // Un damier, pas des rayures : deux colonnes distantes d'un carré sont en
  // opposition de phase — au même endroit, l'une est blanche et l'autre non.
  attendu(c.pointsCompares > 10 && c.opposition > 0.9,
    `les carrés s'alternent aussi horizontalement (opposition ${c.opposition} `
    + `sur ${c.pointsCompares} points)`);
});

test("types : une police propre au type s'applique à l'aperçu et à l'édition", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const visibles = m.nodes.filter(n => !T.hidden().includes(n.filiere));
    visibles.forEach((n, i) => { n.kind = i % 2 ? 'industrie' : 'produit'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Police propre à ce type');
    await reglerCarte('Industries / étapes', 'Graisse', '300');
    await basculer('Industries / étapes', 'Italique');
    await cocher('Produits / commodités', 'Police propre à ce type');
    await reglerCarte('Produits / commodités', 'Graisse', '700');
    // Vue d'édition : la graisse et l'italique du type habillent le nom du nœud.
    const unNoeud = k => visibles.find(n => n.kind === k);
    const styleEdition = k => {
      const cs = getComputedStyle(elOf(unNoeud(k).id).querySelector('.node-label'));
      return { poids: cs.fontWeight, italique: cs.fontStyle };
    };
    const edition = { produit: styleEdition('produit'), industrie: styleEdition('industrie') };
    await versApercu();
    const styleApercu = k => {
      const t = [...document.querySelectorAll('#canvas text[data-kind="' + k + '"]')][0];
      const cs = getComputedStyle(t);
      return { poids: cs.fontWeight, italique: cs.fontStyle };
    };
    const apercu = { produit: styleApercu('produit'), industrie: styleApercu('industrie') };
    await versEdition();
    return { edition, apercu };
  `);
  egal(r.apercu.industrie, { poids: "300", italique: "italic" },
    "les industries sont en fine italique dans l'aperçu");
  egal(r.apercu.produit, { poids: "700", italique: "normal" },
    "les produits sont en grasse droite dans l'aperçu");
  egal(r.edition.industrie, { poids: "300", italique: "italic" },
    "la vue d'édition montre la même distinction");
  egal(r.edition.produit, { poids: "700", italique: "normal" },
    "idem pour les produits");
});

test("majuscules : la bascule [AA] met en capitales l'affichage, pas les données", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const vis = m.nodes.filter(n => !T.hidden().includes(n.filiere));
    const cible = vis[0];
    // Un intitulé de colonne connu, en minuscules, pour toute la colonne visée.
    vis.filter(n => n.column === cible.column).forEach(n => { n.title = 'amont agricole'; });
    T.refresh();
    await sleep(140);

    const titreApercu = () => [...document.querySelectorAll('#canvas text')]
      .map(t => t.textContent).find(t => /amont agricole/i.test(t)) || null;
    const etiquetteApercu = () => {
      const t = document.querySelector('#canvas text[data-label-for="' + cible.id + '"]');
      return t ? t.textContent : null;
    };

    // Le nom est découpé en lignes dans la boîte d'édition : on compare donc
    // l'étiquette d'édition à elle-même, avant et après la bascule.
    const etiquetteEdition = () => elOf(cible.id).querySelector('.node-label').textContent;
    const editionAvant = etiquetteEdition();

    await versApercu();
    const avant = { titre: titreApercu(), etiquette: etiquetteApercu() };
    await versEdition();

    await basculer('Titres de colonnes', 'Majuscules');
    await basculer('Nœuds', 'Majuscules');
    // La vue d'édition suit elle aussi la casse des étiquettes.
    const edition = { avant: editionAvant, apres: etiquetteEdition() };

    await versApercu();
    const apres = { titre: titreApercu(), etiquette: etiquetteApercu() };
    await versEdition();

    return { avant, apres, edition,
             nomModele: byId(cible.id).name, titreModele: byId(cible.id).title };
  `);
  egal(r.avant.titre, "amont agricole", "au départ, le titre de colonne garde sa casse");
  egal(r.apres.titre, "AMONT AGRICOLE", "la bascule met le titre de colonne en capitales");
  egal(r.apres.etiquette, r.avant.etiquette.toLocaleUpperCase("fr"),
    "l'étiquette du nœud passe elle aussi en capitales");
  egal(r.edition.apres, r.edition.avant.toLocaleUpperCase("fr"),
    "la vue d'édition passe elle aussi en capitales");
  egal(r.titreModele, "amont agricole", "le modèle garde le titre tel qu'il est écrit");
  egal(r.nomModele, r.avant.etiquette, "le nom du nœud n'est pas réécrit dans le modèle");
});

test("police : un projet d'avant la graisse revient tel qu'il a été écrit", "complexe", async p => {
  const r = await p(`
    /* Apparence « d'avant » : l'ancien booléen bold, ni weight ni uppercase.
       Les deux valeurs sont prises À L'ENVERS des défauts (titres NON gras,
       étiquettes grasses) : une traduction qui se contenterait de retomber sur
       le défaut passerait inaperçue autrement. */
    T.loadProject({
      version: 1, idCounter: 999, hiddenFilieres: [],
      model: T.model(),
      options: {
        columnHeaders: { show: true, fontColor: '#ffffff', backgroundColor: '#000000',
                         fontFamily: 'Arial, sans-serif', fontSize: 13, bold: false,
                         italic: false, marginTop: 4, marginBottom: 10 },
        nodeLabels: { show: true, fontColor: '#000000', fontFamily: 'Arial, sans-serif',
                      fontSize: 12, bold: true, italic: true, showValue: false,
                      position: 'cote', showBackground: false, backgroundColor: '#ffffff',
                      backgroundOpacity: 80, wrap: false, maxChars: 18 }
      }
    });
    await sleep(200);
    await versApercu();
    const etiquette = document.querySelector('#canvas text[data-label-for]');
    const styleEtiquette = { poids: getComputedStyle(etiquette).fontWeight,
                             italique: getComputedStyle(etiquette).fontStyle,
                             texte: etiquette.textContent };
    await versEdition();
    const c = await carteDuPanneau('Titres de colonnes');
    const graisse = [...c.querySelectorAll('.field')]
      .find(x => x.querySelector('span') && x.querySelector('span').textContent.trim() === 'Graisse')
      .querySelector('select').value;
    const gras = [...c.querySelectorAll('.style-toggle')]
      .find(x => x.title === 'Gras').classList.contains('active');
    const maj = [...c.querySelectorAll('.style-toggle')]
      .find(x => x.title === 'Majuscules').classList.contains('active');
    return { styleEtiquette, graisse, gras, maj };
  `);
  egal(r.graisse, "400", "un titre écrit sans gras revient en « Normale », pas au défaut");
  attendu(!r.gras, "la bascule [G] doit être éteinte");
  attendu(!r.maj, "les capitales sont éteintes sur un projet qui les ignore");
  egal(r.styleEtiquette.poids, "700", "une étiquette écrite en gras revient grasse");
  egal(r.styleEtiquette.italique, "italic", "l'italique d'origine est conservé");
  attendu(r.styleEtiquette.texte === r.styleEtiquette.texte.toLocaleLowerCase("fr")
    || /[a-zà-ÿ]/.test(r.styleEtiquette.texte),
    "l'étiquette n'est pas passée en capitales toute seule");
});

test("majuscules : chaque type de nœud a la sienne", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const vis = m.nodes.filter(n => !T.hidden().includes(n.filiere));
    vis.forEach((n, i) => { n.kind = i % 2 ? 'industrie' : 'produit'; });
    T.refresh();
    await sleep(140);
    await cocher('Industries / étapes', 'Police propre à ce type');
    await basculer('Industries / étapes', 'Majuscules');
    await versApercu();
    const texteDe = k => {
      const t = [...document.querySelectorAll('#canvas text[data-kind="' + k + '"]')][0];
      return t ? t.textContent : null;
    };
    const rendu = { produit: texteDe('produit'), industrie: texteDe('industrie') };
    await versEdition();
    const noms = {
      produit: vis.find(n => n.kind === 'produit').name,
      industrie: vis.find(n => n.kind === 'industrie').name
    };
    return { rendu, noms };
  `);
  egal(r.rendu.industrie, r.noms.industrie.toLocaleUpperCase("fr"),
    "les industries passent en capitales");
  egal(r.rendu.produit, r.noms.produit,
    "les produits, qui n'ont pas de police propre, gardent leur casse");
});

test("police : la bascule [G] et la liste « Graisse » disent la même chose", "complexe", async p => {
  const r = await p(`
    const etat = async () => {
      const c = await carteDuPanneau('Titres de colonnes');
      const b = [...c.querySelectorAll('.style-toggle')].find(x => x.title === 'Gras');
      const f = [...c.querySelectorAll('.field')]
        .find(x => x.querySelector('span') && x.querySelector('span').textContent.trim() === 'Graisse');
      return { gras: b.classList.contains('active'), graisse: f.querySelector('select').value };
    };
    const depart = await etat();
    await basculer('Titres de colonnes', 'Gras');       // la bascule mène
    const apresBascule = await etat();
    await reglerCarte('Titres de colonnes', 'Graisse', '300');  // la liste mène
    const apresListe = await etat();
    return { depart, apresBascule, apresListe };
  `);
  egal(r.depart, { gras: true, graisse: "700" }, "les titres de colonnes partent en grasse");
  egal(r.apresBascule, { gras: false, graisse: "400" },
    "éteindre [G] ramène la liste sur « Normale »");
  egal(r.apresListe, { gras: false, graisse: "300" },
    "choisir « Fine » dans la liste laisse [G] éteint");
});

test("types : Excel→App applique les types du classeur, et les garde sans la colonne", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const a = m.nodes[0], b = m.nodes[1];
    const ligne = n => ({ id: n.id, name: n.name, column: n.column, title: n.title,
                          order: n.order, lane: n.lane, kind: 'produit',
                          filiere: n.filiere, color: n.color });
    // 1. le classeur porte la colonne : elle fait autorité
    const avec = { nodes: [Object.assign(ligne(a), { kind: 'industrie' }), ligne(b)],
                   links: [], hasLane: true, hasKind: true };
    T.setSynced();
    T.reconcile(avec);
    T.refresh();
    await sleep(80);
    const apresAvec = { a: byId(a.id).kind, b: byId(b.id).kind };
    // 2. classeur d'avant les types : l'app garde les siens
    const sans = { nodes: [ligne(a), ligne(b)], links: [], hasLane: true, hasKind: false };
    T.setSynced();
    T.reconcile(sans);
    T.refresh();
    await sleep(80);
    return { apresAvec, apresSans: { a: byId(a.id).kind, b: byId(b.id).kind } };
  `);
  egal(r.apresAvec, { a: "industrie", b: "produit" }, "la colonne « Type » du classeur fait autorité");
  egal(r.apresSans, { a: "industrie", b: "produit" },
    "sans la colonne, les types de l'app sont conservés");
});

test("liens : une ligne saisie dans Excel sans identifiant fait réécrire le classeur", "complexe",
  async p => {
  // Tant que les colonnes « ID origine / ID destination » sont vides, ce lien ne
  // se reconnaît que par les NOMS de ses extrémités — le repli qui confond deux
  // homonymes et leur dispute leur formule. La réconciliation doit donc réclamer
  // une réécriture, qui leur posera leurs identifiants.
  const r = await p(`
    const m = T.model();
    const nom = id => (m.nodes.find(n => n.id === id) || {}).name;
    const ligneN = n => ({ id: n.id, name: n.name, column: n.column, title: n.title,
                           order: n.order, lane: n.lane, kind: n.kind,
                           filiere: n.filiere, color: n.color });
    const ligneL = (l, ids) => ({
      sourceId: ids ? l.source : null, targetId: ids ? l.target : null,
      sourceName: nom(l.source), targetName: nom(l.target),
      value: l.value, unit: l.unit || ''
    });
    const lignesN = m.nodes.map(ligneN);
    const classeur = l => ({ nodes: lignesN, links: l, hasLane: true, hasKind: true });

    T.setSynced();
    const complet = T.reconcile(classeur(m.links.map(l => ligneL(l, true))));
    T.setSynced();
    const nu = T.reconcile(classeur(m.links.map(l => ligneL(l, false))));
    return { complet, nu, liens: T.model().links.length };
  `);
  egal(r.complet, false, "un classeur déjà complet ne déclenche aucune réécriture");
  egal(r.nu, true, "des liens sans identifiant en réclament une");
  attendu(r.liens > 0, "et les liens sont toujours là");
});

test("étiquettes (aperçu) : « Centré » pose le nom sur le nœud, calé aux colonnes de bord",
  "complexe", async p => {
  const r = await p(`
    await reglerCarte('Nœuds', 'Position', 'centre');
    await versApercu();
    const rects = rectsApercu();
    const parId = new Map(etiquettesApercu().map(e => [e.id, e]));
    const axes = [...new Set(rects.map(rc => Math.round(rc.gauche)))].sort((a, b) => a - b);
    const bordDe = rc => Math.round(rc.gauche) === axes[0] ? 'gauche'
      : Math.round(rc.gauche) === axes[axes.length - 1] ? 'droite' : 'milieu';
    const mesures = rects.map(rc => {
      const e = parId.get(rc.id);
      return {
        bord: bordDe(rc),
        ecartGauche: Math.round(e.gauche - rc.gauche),
        ecartDroite: Math.round(e.droite - rc.droite),
        ecartCentre: Math.round((e.gauche + e.droite - rc.gauche - rc.droite) / 2),
        surLeNoeud: e.milieuY > rc.haut && e.milieuY < rc.bas,
        deborde: e.gauche < canvasRect().left
      };
    });
    await versEdition();
    return { nbColonnes: axes.length, mesures };
  `);
  const proche = (v, tol) => Math.abs(v) <= (tol || 3);
  attendu(r.nbColonnes >= 3, "le diagramme doit avoir des colonnes de bord ET du milieu");
  const milieu = r.mesures.filter(m => m.bord === 'milieu');
  const gauche = r.mesures.filter(m => m.bord === 'gauche');
  const droite = r.mesures.filter(m => m.bord === 'droite');
  attendu(milieu.length && gauche.length && droite.length, "les trois cas doivent être peuplés");
  attendu(milieu.every(m => proche(m.ecartCentre)),
    "hors des bords, l'étiquette doit être centrée sur le nœud");
  attendu(gauche.every(m => proche(m.ecartGauche)),
    "à la première colonne, l'étiquette doit se caler sur le bord gauche du nœud");
  attendu(droite.every(m => proche(m.ecartDroite)),
    "à la dernière colonne, l'étiquette doit se caler sur le bord droit du nœud");
  attendu(r.mesures.every(m => m.surLeNoeud),
    "une étiquette centrée doit se poser sur la boîte, pas à côté");
  attendu(r.mesures.every(m => !m.deborde),
    "aucune étiquette ne doit sortir du cadre du graphique");
});

test("étiquettes (aperçu) : produits et industries ont leur propre position", "complexe",
  async p => {
  const r = await p(`
    const visibles = T.model().nodes.filter(n => !T.hidden().includes(n.filiere));
    visibles.forEach((n, i) => { n.kind = i % 2 ? 'industrie' : 'produit'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', "Position d'étiquette propre à ce type");
    await reglerCarte('Industries / étapes', "Position de l'étiquette", 'centre');
    await cocher('Produits / commodités', "Position d'étiquette propre à ce type");
    await reglerCarte('Produits / commodités', "Position de l'étiquette", 'dessous');
    await versApercu();
    const parId = new Map(etiquettesApercu().map(e => [e.id, e]));
    const cas = rectsApercu().map(rc => {
      const e = parId.get(rc.id);
      return { kind: rc.kind,
               surLeNoeud: e.milieuY > rc.haut && e.milieuY < rc.bas,
               dessous: e.haut >= rc.bas };
    });
    await versEdition();
    return { industries: cas.filter(c => c.kind === 'industrie'),
             produits: cas.filter(c => c.kind === 'produit') };
  `);
  attendu(r.industries.length && r.produits.length, "les deux types doivent être représentés");
  attendu(r.industries.every(c => c.surLeNoeud),
    "les industries doivent porter leur nom au centre de leur boîte");
  attendu(r.produits.every(c => c.dessous),
    "les produits doivent garder leur nom sous leur boîte");
});

test("étiquette : un nom long agrandit la boîte et passe à la ligne", "complexe", async p => {
  const r = await p(`
    const long = one('Production végétale, collecte, stockage');
    const court = one('Féverolle');
    const boite = id => elOf(id).querySelector('.node-box').getBoundingClientRect();
    const lignes = id => elOf(id).querySelectorAll('.node-label tspan').length;
    return {
      hauteurLongue: Math.round(boite(long.id).height),
      hauteurCourte: Math.round(boite(court.id).height),
      lignesLongue: lignes(long.id),
      lignesCourte: lignes(court.id),
      nomAffiche: [...elOf(long.id).querySelectorAll('.node-label tspan')].map(t => t.textContent).join(' ')
    };
  `);
  attendu(r.lignesLongue > 1, "un nom long doit être réparti sur plusieurs lignes");
  egal(r.lignesCourte, 1, "un nom court tient sur une ligne");
  attendu(r.hauteurLongue > r.hauteurCourte, "la boîte doit grandir avec le nombre de lignes");
  egal(r.hauteurCourte, 38, "un nœud d'une ligne garde sa hauteur d'origine");
  egal(r.nomAffiche, "Production végétale, collecte, stockage", "le nom complet doit rester lisible");
});

test("étiquette : les nœuds empilés ne se chevauchent pas", "complexe", async p => {
  const r = await p(`
    const chevauchements = [];
    const colonnes = [...new Set(nodes().filter(n => elOf(n.id)).map(n => n.column))];
    for (const c of colonnes) {
      const boites = nodes().filter(n => n.column === c && elOf(n.id))
        .map(n => ({ nom: n.name, r: elOf(n.id).querySelector('.node-box').getBoundingClientRect() }))
        .sort((a, b) => a.r.top - b.r.top);
      for (let i = 1; i < boites.length; i++) {
        if (boites[i].r.top < boites[i - 1].r.bottom) {
          chevauchements.push(boites[i - 1].nom + ' / ' + boites[i].nom);
        }
      }
    }
    return { chevauchements };
  `);
  egal(r.chevauchements, [], "aucune paire de nœuds ne doit se chevaucher");
});

test("étiquette : le déplacement vise le bon rang malgré les hauteurs variables", "complexe", async p => {
  const r = await p(`
    // « Féverolle » (court) passe sous « Importation hors bretagne » dans sa colonne
    const n = one('Féverolle');
    await selectNode(n.id);
    const avant = byId(n.id).order;
    await dragNode(n.id, 0, 1);
    const apres = byId(n.id).order;
    const memeColonne = colonneVisible(byId(n.id).column);
    return { avant, apres, ordre: memeColonne };
  `.replace('colonneVisible(byId(n.id).column)',
            'nodes().filter(x => x.column === byId(n.id).column && elOf(x.id)).sort((a,b)=>a.order-b.order).map(x=>x.name)'));
  attendu(r.apres > r.avant, `le nœud doit descendre d'un rang (${r.avant} -> ${r.apres}, ordre : ${r.ordre.join(" | ")})`);
});

test("palette : propose les couleurs déjà utilisées dans le document", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    await selectNode(n.id);
    document.querySelector('#sidebar .color-btn').click();
    await sleep(80);
    const titres = [...document.querySelectorAll('.cp-sub')].map(e => e.textContent);
    const iDoc = titres.indexOf('Couleurs utilisées dans le document');
    const ligne = document.querySelectorAll('.cp-row')[iDoc];
    const proposees = [...ligne.querySelectorAll('.cp-swatch')].map(b => b.dataset.hex);
    const employees = new Set(nodes().map(x => (x.color || '').toLowerCase()).filter(Boolean));
    return {
      titres,
      proposees,
      toutesEmployees: proposees.filter(h => !employees.has(h)),
      couvreLesNoeuds: [...employees].filter(h => !proposees.includes(h)),
      sansDoublon: proposees.length === new Set(proposees).size
    };
  `);
  attendu(r.titres.includes("Couleurs utilisées dans le document"), "la section doit exister");
  attendu(r.sansDoublon, "chaque couleur ne doit apparaître qu'une fois");
  egal(r.couvreLesNoeuds, [], "toutes les couleurs de nœuds doivent être proposées");
});

test("panneau : les champs nombre et couleur tiennent en demi-colonne", "complexe", async p => {
  const r = await p(`
    await selectNode(one('Féverolle').id);
    const carte = [...document.querySelectorAll('#sidebar details')]
        .find(d => /Liens/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(80);
    const corps = carte.querySelector('.card-body');
    const largeur = corps.getBoundingClientRect().width;
    const mesure = sel => {
      const e = corps.querySelector(sel);
      return e ? Math.round(e.getBoundingClientRect().width) : null;
    };
    return {
      largeur: Math.round(largeur),
      demiCouleur: mesure('.field.half .color-btn') !== null
        ? Math.round(corps.querySelector('.field.half').getBoundingClientRect().width) : null,
      pleinSelect: mesure('.field:not(.half) select'),
      nbDemis: corps.querySelectorAll('.field.half').length
    };
  `);
  attendu(r.nbDemis > 0, "la carte doit contenir des champs en demi-colonne");
  attendu(r.demiCouleur < r.largeur * 0.6,
    `un champ demi-colonne doit faire environ la moitié de la carte (${r.demiCouleur} sur ${r.largeur})`);
});

test("filières empilées : un Sankey et un titre par filière", "complexe", async p => {
  const r = await p(`
    T.setHiddenNone && T.setHiddenNone();
    // rend les deux filières visibles
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    // active l'empilement
    const carte = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(60);
    const bascule = [...carte.querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input');
    bascule.click();
    await sleep(150);
    // passe en aperçu
    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(300);
    const titres = [...document.querySelectorAll('#canvas > text')].map(t => t.textContent);
    const blocs = document.querySelectorAll('#canvas > g[transform^="translate(0,"]');
    const ordonnees = [...blocs].map(g => parseFloat(g.getAttribute('transform').match(/translate\\(0,([-\\d.]+)\\)/)[1]));
    // On rend la main en vue Édition : sinon le test suivant ne trouve aucun nœud.
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
    return { titres, nbBlocs: blocs.length, ordonnees, filieres: T.hidden() };
  `);
  attendu(r.titres.includes("Blé tendre") && r.titres.includes("Lentilles"),
    `les deux filières doivent être titrées (obtenu : ${JSON.stringify(r.titres)})`);
  egal(r.nbBlocs, 2, "un bloc de diagramme par filière");
  attendu(r.ordonnees[1] > r.ordonnees[0], "les blocs doivent être empilés verticalement");
});

test("filières empilées : l'espacement est réglable", "complexe", async p => {
  const r = await p(`
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    const carte = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(60);
    [...carte.querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input').click();
    await sleep(150);
    const lire = async () => {
      document.querySelectorAll('#toolbar .segmented .seg')[1].click();
      await sleep(250);
      const g = [...document.querySelectorAll('#canvas > g[transform^="translate(0,"]')];
      const y = g.map(e => parseFloat(e.getAttribute('transform').match(/translate\\(0,([-\\d.]+)\\)/)[1]));
      document.querySelectorAll('#toolbar .segmented .seg')[0].click();
      await sleep(150);
      return y[1] - y[0];
    };
    // Point bas : marge nulle
    const carte0 = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte0.open = true;
    await sleep(60);
    const champ0 = [...carte0.querySelectorAll('.field')]
      .find(f => /Marge entre les graphiques/.test(f.textContent)).querySelector('input');
    champ0.focus(); champ0.value = '0';
    champ0.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const avant = await lire();
    // La bascule reconstruit le panneau : il faut retrouver la carte.
    const carte2 = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte2.open = true;
    await sleep(60);
    const champ = [...carte2.querySelectorAll('.field')]
      .find(f => /Marge entre les graphiques/.test(f.textContent)).querySelector('input');
    champ.focus(); champ.value = '160';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const apres = await lire();
    return { avant, apres };
  `);
  // À échelle commune, agrandir la marge réduit aussi la hauteur des blocs :
  // l'écart entre origines croît donc moins vite que la marge elle-même.
  attendu(r.apres > r.avant + 10,
    `augmenter la marge doit éloigner les blocs (${Math.round(r.avant)} -> ${Math.round(r.apres)})`);
});

test("filières empilées : l'échelle commune rend les épaisseurs comparables", "complexe", async p => {
  const r = await p(`
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent)).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    const carte = () => [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    const coche = (libelle) => {
      const c = carte(); c.open = true;
      return [...c.querySelectorAll('.field.check')]
        .find(f => new RegExp(libelle).test(f.textContent)).querySelector('input');
    };
    coche('Un Sankey par filière').click();
    await sleep(200);

    // Épaisseur au pixel du plus gros lien de chaque bloc, et flux correspondant.
    const mesurer = async () => {
      document.querySelectorAll('#toolbar .segmented .seg')[1].click();
      await sleep(300);
      const blocs = [...document.querySelectorAll('#canvas > g[transform^="translate(0,"]')];
      // Hauteur du plus grand rectangle de NŒUD (2e groupe du bloc : après les
      // liens, avant les valeurs/étiquettes/titres) : elle est proportionnelle au
      // flux qui le traverse. Les barres de titres de colonnes sont ainsi exclues.
      const parBloc = blocs.map(b => Math.max(
        ...[...b.querySelectorAll('rect[data-id]')]
          .map(e => e.getBoundingClientRect().height), 0));
      document.querySelectorAll('#toolbar .segmented .seg')[0].click();
      await sleep(150);
      return parBloc;
    };
    const commune = await mesurer();
    const bascule = coche('Même échelle pour tous');
    bascule.click();               // -> échelle indépendante
    await sleep(200);
    const libre = await mesurer();
    // Flux maximal réel de chaque filière, d'après le modèle
    // Flux du nœud le plus chargé de chaque filière (max entrant/sortant)
    const flux = ['Blé tendre', 'Lentilles'].map(f => {
      const ids = new Set(nodes().filter(n => n.filiere === f).map(n => n.id));
      const dedans = links().filter(l => ids.has(l.source) && ids.has(l.target));
      const cumul = new Map();
      const add = (k, v) => cumul.set(k, (cumul.get(k) || 0) + v);
      dedans.forEach(l => { add('o' + l.source, l.value); add('i' + l.target, l.value); });
      return Math.max(...[...ids].map(id =>
        Math.max(cumul.get('o' + id) || 0, cumul.get('i' + id) || 0)));
    });
    return { commune, libre, flux };
  `);
  attendu(r.commune.length === 2 && r.libre.length === 2, "deux blocs doivent être mesurés");
  // À échelle commune, le rapport des épaisseurs doit suivre le rapport des flux.
  const rapportFlux = r.flux[0] / r.flux[1];
  const rapportCommune = r.commune[0] / r.commune[1];
  const rapportLibre = r.libre[0] / r.libre[1];
  attendu(Math.abs(rapportCommune - rapportFlux) < Math.abs(rapportLibre - rapportFlux),
    `à échelle commune, les épaisseurs doivent suivre les flux (flux ${rapportFlux.toFixed(2)}, ` +
    `commune ${rapportCommune.toFixed(2)}, libre ${rapportLibre.toFixed(2)})`);
});

test("marges du graphique : le haut décale le rendu", "complexe", async p => {
  const r = await p(`
    const hautDuRendu = async () => {
      document.querySelectorAll('#toolbar .segmented .seg')[1].click();
      await sleep(300);
      const g = document.querySelector('#canvas > g');
      const m = (g.getAttribute('transform') || 'translate(0,0)').match(/translate\\(0,([-\\d.]+)\\)/);
      document.querySelectorAll('#toolbar .segmented .seg')[0].click();
      await sleep(150);
      return m ? parseFloat(m[1]) : 0;
    };
    const avant = await hautDuRendu();
    const carte = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
    carte.open = true; await sleep(60);
    const champ = [...carte.querySelectorAll('.field')]
      .find(f => /Marge en haut/.test(f.textContent)).querySelector('input');
    champ.focus(); champ.value = '90';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    const apres = await hautDuRendu();
    return { avant, apres };
  `);
  egal(r.avant, 0, "sans marge, le rendu commence en haut");
  egal(r.apres, 90, "la marge en haut doit décaler le rendu d'autant");
});

test("panneau : une section reste ouverte quand on change une option", "complexe", async p => {
  const r = await p(`
    const carte = () => [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    carte().open = true;
    await sleep(80);
    const avant = carte().open;
    [...carte().querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input').click();
    await sleep(200);
    const apres = carte().open;
    // Une autre carte, laissée fermée, doit le rester
    const autre = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Valeurs des liens/.test(d.querySelector('summary').textContent));
    return { avant, apres, autreOuverte: autre.open };
  `);
  attendu(r.avant, "la section doit être ouverte au départ");
  attendu(r.apres, "cocher une option ne doit pas replier la section");
  attendu(!r.autreOuverte, "les sections fermées doivent le rester");
});

test("filières empilées : chaque diagramme garde ses propres dégradés", "complexe", async p => {
  const r = await p(`
    [...document.querySelectorAll('#sidebar button.linklike')]
      .find(b => /Tout afficher/.test(b.textContent)).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(120);
    // active les dégradés
    const liens = [...document.querySelectorAll('#sidebar details')]
      .find(d => /^Liens/.test(d.querySelector('summary').textContent));
    liens.open = true; await sleep(60);
    [...liens.querySelectorAll('.field.check')]
      .find(f => /Dégradé/.test(f.textContent)).querySelector('input').click();
    await sleep(150);
    // active l'empilement
    const marges = [...document.querySelectorAll('#sidebar details')]
      .find(d => /Filières empilées/.test(d.querySelector('summary').textContent));
    marges.open = true; await sleep(60);
    [...marges.querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input').click();
    await sleep(200);
    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(400);

    const ids = [...document.querySelectorAll('#canvas linearGradient')].map(g => g.id);
    const blocs = [...document.querySelectorAll('#canvas > g[transform^="translate(0,"]')];
    // Chaque ruban doit viser un dégradé défini dans SON bloc.
    const horsBloc = [];
    blocs.forEach((b, i) => {
      const propres = new Set([...b.querySelectorAll('linearGradient')].map(g => g.id));
      [...b.querySelectorAll('path[fill^="url("]')].forEach(p => {
        const id = p.getAttribute('fill').slice(5, -1);
        if (!propres.has(id)) horsBloc.push('bloc ' + i + ' -> ' + id);
      });
    });
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
    return {
      nbDegrades: ids.length,
      doublons: ids.filter((v, i) => ids.indexOf(v) !== i),
      horsBloc,
      nbBlocs: blocs.length
    };
  `);
  attendu(r.nbDegrades > 0, "des dégradés doivent être produits");
  egal(r.doublons, [], "aucun identifiant de dégradé ne doit être partagé entre les blocs");
  egal(r.horsBloc, [], "chaque ruban doit référencer un dégradé de son propre diagramme");
});

test("sélection : un seul clic suffit après avoir édité un champ", "complexe", async p => {
  const r = await p(`
    const a = one('Féverolle');
    const b = one('Lentilles sèches');
    await selectNode(a.id);
    // L'utilisatrice tape dans le panneau, puis clique directement sur un autre nœud.
    const champ = field('Nom');
    champ.focus();
    champ.value = 'Féverolle bio';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);
    const sel = await selectNodeReel(b.id);   // UN seul clic, cible re-résolue
    return { attendu: b.id, obtenu: sel.id, nom: byId(a.id).name };
  `);
  egal(r.obtenu, r.attendu, "un seul clic doit suffire pour passer sur un autre nœud");
});

test("intitulé de colonne : le champ vaut pour toute la colonne", "complexe", async p => {
  const r = await p(`
    const n = one('Lentilles sèches');       // colonne 4
    await selectNode(n.id);
    await setField('Intitulé de colonne', 'Produits secs');
    const col = nodes().filter(x => x.column === n.column);
    return { total: col.length, avec: col.filter(x => x.title === 'Produits secs').length,
             noms: col.map(x => x.name) };
  `);
  egal(r.avec, r.total,
    `tous les nœuds de la colonne doivent porter l'intitulé (${r.noms.join(", ")})`);
});

test("intitulé de colonne : un nœud déplacé adopte celui de sa nouvelle colonne", "complexe", async p => {
  const r = await p(`
    // On donne un intitulé aux colonnes 2 et 3, puis on déplace un nœud de 2 vers 3.
    const a = one('Féverolle');              // colonne 2
    await selectNode(a.id);
    await setField('Intitulé de colonne', 'Collecte');
    const b = one('Tri, décorticage, conditionnement');  // colonne 3
    await selectNode(b.id);
    await setField('Intitulé de colonne', 'Transformation');
    await sleep(80);
    await selectNode(a.id);
    await dragNode(a.id, 1, 0);
    return {
      colonne: byId(a.id).column,
      titre: byId(a.id).title,
      titreColonne: (nodes().find(x => x.column === byId(a.id).column && x.id !== a.id) || {}).title
    };
  `);
  egal(r.colonne, 3, "le nœud doit avoir changé de colonne");
  egal(r.titre, "Transformation", "il doit adopter l'intitulé de sa nouvelle colonne");
  egal(r.titre, r.titreColonne, "et coïncider avec ses nouveaux voisins");
});

test("étiquette : le numéro de colonne n'est plus affiché dans le nœud", "complexe", async p => {
  const r = await p(`
    const n = one('Féverolle');
    const el = elOf(n.id);
    return { badges: el.querySelectorAll('.node-badge').length,
             texte: el.textContent.trim() };
  `);
  egal(r.badges, 0, "plus de badge « col N »");
  attendu(!/col\s*\d/.test(r.texte), `aucun numéro de colonne dans le nœud (${r.texte})`);
});

test("part bio : un bandeau vert recouvre la part bio du ruban", "complexe", async p => {
  // Ce qui compte n'est pas qu'un tracé de plus existe, mais QUELLE PART du
  // ruban il recouvre, et depuis quel bord : mesuré sur la peinture (isPointInFill).
  const r = await p(`
    const m = T.model();
    const nom = id => (m.nodes.find(n => n.id === id) || {}).name;
    const ligneN = n => ({ id: n.id, name: n.name, column: n.column, title: n.title,
                           order: n.order, lane: n.lane, kind: n.kind,
                           filiere: n.filiere, color: n.color });
    const lignesN = m.nodes.map(ligneN);
    const classeur = bio => ({
      nodes: lignesN,
      links: m.links.map(l => ({
        sourceId: l.source, targetId: l.target,
        sourceName: nom(l.source), targetName: nom(l.target),
        value: l.value, unit: l.unit || '', bio
      })),
      hasLane: true, hasKind: true, hasBio: true
    });
    const poser = async bio => {
      T.setSynced();
      T.reconcile(classeur(bio));
      T.refresh();
      await sleep(150);
    };

    await versApercu();
    await poser(0);
    const sansBio = { bandeaux: document.querySelectorAll('#canvas path.lien-bio').length,
                      traces: tracesRubans() };
    await poser(0.5);
    const moitie = { mesures: rubansMesures(3), traces: tracesRubans() };
    await poser(1);
    const tout = rubansMesures(3);
    return { sansBio, moitie, tout };
  `);
  egal(r.sansBio.bandeaux, 0, "à 0 %, aucun bandeau n'est peint");
  attendu(r.moitie.mesures.length === 3, "trois rubans mesurés");
  r.moitie.mesures.forEach(mes => {
    attendu(Math.abs(mes.part - 0.5) < 0.06,
      `à 50 %, le bandeau doit couvrir la moitié du ruban ${mes.lien} (mesuré ${mes.part})`);
    attendu(mes.ecartHaut !== null && mes.ecartHaut < 1,
      `le bandeau de ${mes.lien} doit partir du bord supérieur du ruban`);
  });
  r.tout.forEach(mes => {
    attendu(mes.part > 0.94,
      `à 100 %, le ruban ${mes.lien} doit être entièrement vert (mesuré ${mes.part})`);
  });
  // Deux flux collés l'un à l'autre, pas un ruban de plus : l'épaisseur du flux
  // ne bouge pas d'un pixel quand la part bio change.
  egal(r.moitie.traces, r.sansBio.traces, "les rubans eux-mêmes sont inchangés");
});

test("part bio : la carte « Liens » sait éteindre le bandeau", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const nom = id => (m.nodes.find(n => n.id === id) || {}).name;
    T.setSynced();
    T.reconcile({
      nodes: m.nodes.map(n => ({ id: n.id, name: n.name, column: n.column, title: n.title,
                                 order: n.order, lane: n.lane, kind: n.kind,
                                 filiere: n.filiere, color: n.color })),
      links: m.links.map(l => ({
        sourceId: l.source, targetId: l.target,
        sourceName: nom(l.source), targetName: nom(l.target),
        value: l.value, unit: l.unit || '', bio: 0.5
      })),
      hasLane: true, hasKind: true, hasBio: true
    });
    T.refresh();
    await versApercu();
    const avant = document.querySelectorAll('#canvas path.lien-bio').length;
    await cocher('Liens', 'Part bio / durable');
    const apres = document.querySelectorAll('#canvas path.lien-bio').length;
    return { avant, apres };
  `);
  attendu(r.avant > 0, "des bandeaux sont peints tant que l'option est cochée");
  egal(r.apres, 0, "décochée, plus aucun bandeau");
});

test("aperçu : cliquer un libellé sélectionne son nœud", "complexe", async p => {
  const r = await p(`
    const cible = one('Féverolle');
    await versApercu();
    const et = etiquettesApercu().find(e => e.id === cible.id);
    if (!et) throw new Error("étiquette non peinte : " + cible.id);
    // Un point HORS des glyphes mais dans le bloc de l'étiquette : c'est
    // précisément ce qu'un <text> nu laisse passer au travers.
    await clicReel(et.gauche - 2, et.milieuY);
    const sel = T.selection();
    const halo = document.querySelectorAll('#canvas .apercu-selection').length;
    const nom = field('Nom') ? field('Nom').value : null;
    const vue = T.view();
    await versEdition();
    return { attendu: cible.id, sel, halo, nom, vue, nomCible: cible.name };
  `);
  egal(r.vue, "preview", "le clic ne doit pas faire sortir de l'aperçu");
  egal(r.sel.type, "node", "un nœud doit être sélectionné");
  egal(r.sel.id, r.attendu, "et ce doit être celui du libellé cliqué");
  egal(r.nom, r.nomCible, "le panneau doit ouvrir la carte de ce nœud");
  egal(r.halo, 1, "un repère de sélection, et un seul, doit entourer le libellé");
});

test("aperçu : le repère de sélection suit le libellé et disparaît avec lui", "complexe", async p => {
  const r = await p(`
    const a = one('Féverolle');
    const b = one('Lentilles sèches');
    await versApercu();
    const et = id => etiquettesApercu().find(e => e.id === id);

    await clicReel(et(a.id).gauche - 2, et(a.id).milieuY);
    // Le halo doit être posé DANS le groupe de l'étiquette : c'est ce qui lui
    // fait partager son système de coordonnées, donc son emplacement.
    const surA = document.querySelector('#canvas .apercu-selection')
      .parentNode.getAttribute('data-label-for');

    await clicReel(et(b.id).gauche - 2, et(b.id).milieuY);
    const surB = document.querySelector('#canvas .apercu-selection')
      .parentNode.getAttribute('data-label-for');
    const combien = document.querySelectorAll('#canvas .apercu-selection').length;

    // Clic dans le vide : la sélection se referme, faute de quoi l'aperçu
    // n'offre aucun moyen de la défaire.
    const c = canvasRect();
    await clicReel(c.left + 3, c.bottom - 3);
    const apres = T.selection();
    const restant = document.querySelectorAll('#canvas .apercu-selection').length;

    await versEdition();
    return { a: a.id, b: b.id, surA, surB, combien, apres, restant };
  `);
  egal(r.surA, r.a, "le repère entoure le libellé cliqué");
  egal(r.surB, r.b, "puis celui du nœud suivant");
  egal(r.combien, 1, "jamais deux repères à la fois");
  egal(r.apres.type, null, "un clic dans le vide désélectionne");
  egal(r.restant, 0, "et retire le repère");
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
// `pilotage` : l'app sait-elle écrire dans le classeur ouvert (excel-live.js) ?
// À false, on retrouve l'ancien comportement — refus, modale, fermeture d'Excel.
const excelSimule = {
  ecritures: 0,
  derniereEcriture: null,
  apparence: null,
  /** Ce que l'écriture répond quand elle défait une recopie d'Excel. */
  remplissage: null
};

/**
 * Les bouchons du classeur. Le banc n'a pas d'Excel : `readExcel` échoue
 * volontairement, ce qui laisse `amorceFaite` à faux — donc AUCUNE écriture
 * automatique pendant les tests d'édition. Le test qui veut la synchro
 * automatique déclare l'amorce lui-même (`T.amorce(true)`).
 */
function stubExcelIpc() {
  ipcMain.handle("excel:read", () => ({ ok: false, error: "bouchon" }));
  ipcMain.handle("excel:write", (_e, model) => {
    excelSimule.ecritures++;
    excelSimule.derniereEcriture = model;
    const r = { ok: true, live: true, path: "Classeur d'essai.xlsx", sheetName: "Diagramme" };
    if (excelSimule.remplissage) r.remplissage = excelSimule.remplissage;
    return r;
  });
  ipcMain.handle("apparence:lire", () => null);
  ipcMain.handle("apparence:ecrire", (_e, json) => {
    excelSimule.apparence = json;
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  stubExcelIpc();
  const win = new BrowserWindow({
    width: 1000, height: 620, show: false,
    webPreferences: {
      preload: path.join(__dirname, "pont-essai.js"),
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
      excelSimule.ecritures = 0;
      excelSimule.derniereEcriture = null;
      excelSimule.apparence = null;
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
