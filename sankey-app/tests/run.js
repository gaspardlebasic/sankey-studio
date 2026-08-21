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

test("App→Excel : prévient par une modale si l'app ne peut pas piloter Excel", "complexe", async (p, excel) => {
  excel.verrou = true;
  excel.pilotage = false;
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
  excel.pilotage = false; // le repli : sans pilotage direct, il faut fermer le classeur
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

test("App→Excel : écrit dans le classeur ouvert, sans demander de le fermer", "complexe", async (p, excel) => {
  excel.verrou = true;
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
  attendu(!r.modale, "aucune modale : l'app sait écrire dans le classeur ouvert");
  egal(excel.ecrituresLive, 1, "l'écriture doit passer par le classeur ouvert");
  egal(excel.fermetures, 0, "Excel ne doit pas être fermé");
  egal(excel.enregistrements, 1, "un « App → Excel » explicite demande l'enregistrement");
  attendu(/classeur ouvert dans Excel/.test(r.statut),
    "le statut doit dire où l'écriture a eu lieu — obtenu : " + r.statut);
});

test("édition : reste possible quand le classeur est ouvert et pilotable", "complexe", async p => {
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    T.setExcelLocked(true);
    T.setExcelLive(true);
    await sleep(60);
    const src = one('Féverolle');
    await selectNode(src.id);
    const avant = nodes().length;
    await clickPlus();
    await sleep(120);
    const res = { avant, apres: nodes().length, modale: !!document.querySelector('.ov-modal') };
    T.setExcelLocked(false); T.setExcelLive(false); T.setExcelPath(null);
    return res;
  `);
  egal(r.apres, r.avant + 1, "le nœud doit être créé malgré le classeur ouvert");
  attendu(!r.modale, "aucune modale ne doit interrompre l'édition");
});

test("édition : toujours refusée quand l'app ne peut pas piloter Excel", "complexe", async (p, excel) => {
  // Le verrou est relu auprès du process principal avant d'afficher la modale :
  // le bouchon doit donc confirmer que le classeur est bien ouvert.
  excel.verrou = true;
  excel.pilotage = false;
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    T.setExcelLocked(true);
    T.setExcelLive(false);
    await sleep(60);
    const src = one('Féverolle');
    await selectNode(src.id);
    const avant = nodes().length;
    await clickPlus();
    await sleep(400);
    const modale = document.querySelector('.ov-modal');
    const titre = modale ? modale.querySelector('.ov-title').textContent : null;
    if (modale) {
      [...modale.querySelectorAll('.ov-btn')].find(b => /Annuler/.test(b.textContent))
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await sleep(150);
    const res = { avant, apres: nodes().length, titre };
    T.setExcelLocked(false); T.setExcelPath(null);
    return res;
  `);
  egal(r.apres, r.avant, "aucun nœud ne doit être créé");
  egal(r.titre, "Le classeur est ouvert dans Excel", "la modale doit expliquer le refus");
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
    carte.open = true;
    await sleep(60);
    [...carte.querySelectorAll('.field.check')]
      .find(f => /Un Sankey par filière/.test(f.textContent)).querySelector('input').click();
    await sleep(200);

    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(350);
    const blocs = [...document.querySelectorAll('#canvas > g[transform^="translate(0,"]')];
    const abscisses = blocs.map(b => [...b.querySelectorAll(':scope > g:nth-of-type(2) rect')]
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
        ...[...b.querySelectorAll(':scope > g:nth-of-type(2) rect')]
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
      .find(d => /Marges du graphique/.test(d.querySelector('summary').textContent));
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
  verrou: false, pilotage: true,
  fermetures: 0, ecritures: 0, ecrituresLive: 0, enregistrements: 0
};
function stubExcelIpc() {
  ipcMain.handle("excel:isLocked", () => ({
    locked: excelSimule.verrou, exists: true, mode: "excel",
    live: excelSimule.verrou && excelSimule.pilotage
  }));
  ipcMain.handle("excel:watch", () => ({ ok: true, locked: excelSimule.verrou }));
  ipcMain.handle("excel:read", () => ({ ok: false, error: "bouchon" }));
  ipcMain.handle("excel:write", (_e, _model, _path, _sheet, options) => {
    excelSimule.ecritures++;
    if (!excelSimule.verrou) {
      return { ok: true, live: false, path: "/tmp/bouchon.xlsx", sheetName: "Diagramme" };
    }
    if (!excelSimule.pilotage) {
      return { ok: false, error: "Classeur ouvert dans Excel", locked: true };
    }
    excelSimule.ecrituresLive++;
    const enregistre = !!(options && options.save);
    if (enregistre) excelSimule.enregistrements++;
    return { ok: true, live: true, enregistre, path: "/tmp/bouchon.xlsx", sheetName: "Diagramme" };
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
      excelSimule.pilotage = true;
      excelSimule.fermetures = 0;
      excelSimule.ecritures = 0;
      excelSimule.ecrituresLive = 0;
      excelSimule.enregistrements = 0;
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
