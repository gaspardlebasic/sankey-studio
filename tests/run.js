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
const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
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

test("presse-papier Excel : format TSV complet avec nœuds, colonne vide et liens", "complexe", async p => {
  const r = await p(`
    const tsv = T.formatExcelClipboard();
    const lignes = tsv.split('\\r\\n');
    const entetes = lignes[0].split('\\t');
    const model = T.model();
    const l1 = lignes[1] ? lignes[1].split('\\t') : [];
    return {
      nbLignes: lignes.length,
      nbColonnesEntete: entetes.length,
      enteteNoeuds: entetes.slice(0, 9),
      colonneVide: entetes[9],
      enteteLiens: entetes.slice(10),
      nbNoeuds: model.nodes.length,
      nbLiens: model.links.length,
      premierLigneCol: l1.length
    };
  `);
  egal(r.nbColonnesEntete, 17, "17 colonnes au total : 9 nœuds + 1 vide + 7 liens");
  egal(r.colonneVide, "", "la 10e colonne (colonne J) doit être vide");
  egal(r.enteteNoeuds[0], "Filière");
  egal(r.enteteNoeuds[1], "Noeud");
  egal(r.enteteNoeuds[2], "Numéro de colonne d'affichage");
  egal(r.enteteNoeuds[3], "Intitulé de la colonne d'affichage");
  egal(r.enteteNoeuds[4], "Ordre vertical d'affichage");
  egal(r.enteteNoeuds[5], "Couleur");
  egal(r.enteteNoeuds[6], "ID");
  egal(r.enteteNoeuds[7], "Couloir");
  egal(r.enteteNoeuds[8], "Type");
  egal(r.enteteLiens[0], "Filière");
  egal(r.enteteLiens[1], "Origine");
  egal(r.enteteLiens[2], "Destination");
  egal(r.enteteLiens[3], "Valeur du flux");
  egal(r.enteteLiens[4], "Unité");
  egal(r.enteteLiens[5], "ID origine");
  egal(r.enteteLiens[6], "ID destination");
  egal(r.nbLignes, Math.max(r.nbNoeuds, r.nbLiens) + 1, "1 ligne d'en-tête + max(nœuds, liens) lignes");
});

test("presse-papier Excel : les lignes descendent par filière, colonne, couloir puis ordre", "complexe", async p => {
  const r = await p(`
    const lignes = T.formatExcelClipboard().split('\\r\\n');
    const entetes = lignes[0].split('\\t');
    const iF = entetes.indexOf('Filière'), iC = entetes.indexOf("Numéro de colonne d'affichage");
    const iL = entetes.indexOf('Couloir'), iO = entetes.indexOf("Ordre vertical d'affichage");
    const iId = entetes.indexOf('ID');
    const iFL = entetes.indexOf('Filière', 10);
    const corps = lignes.slice(1).map(l => l.split('\\t'));
    return {
      cles: corps.filter(cs => cs[iId]).map(cs => [cs[iF], Number(cs[iC]), Number(cs[iL]), Number(cs[iO])]),
      filieresLiens: corps.map(cs => cs[iFL]).filter(f => f),
      nbNoeuds: T.model().nodes.length,
      nbLiens: T.model().links.length
    };
  `);
  egal(r.cles.length, r.nbNoeuds, "toutes les lignes de nœuds sont présentes");
  const rang = (a, b) =>
    a[0].localeCompare(b[0], "fr", { sensitivity: "base" }) || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
  for (let i = 1; i < r.cles.length; i++) {
    attendu(rang(r.cles[i - 1], r.cles[i]) <= 0,
      `ligne ${i + 1} mal rangée : ${JSON.stringify(r.cles[i - 1])} devrait précéder ${JSON.stringify(r.cles[i])}`);
  }
  egal(r.filieresLiens.length, r.nbLiens, "toutes les lignes de liens sont présentes");
  // Chaque filière ne doit apparaître que d'un seul tenant dans le tableau des liens.
  const vues = new Set();
  let precedente = null;
  for (const f of r.filieresLiens) {
    if (f !== precedente) {
      attendu(!vues.has(f), `la filière « ${f} » revient après une autre : les liens ne sont pas groupés`);
      vues.add(f);
      precedente = f;
    }
  }
});

test("bouton copier Excel : copie les données et affiche la confirmation", "complexe", async p => {
  const r = await p(`
    const btn = [...document.querySelectorAll('#sidebar button')]
        .find(b => /Copier les données Excel/.test(b.textContent));
    if (!btn) return { trouve: false };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(200);
    return {
      trouve: true,
      texteBouton: btn.textContent,
      statut: document.getElementById('status').textContent
    };
  `);
  attendu(r.trouve, "le bouton Copier les données Excel doit être présent dans la barre latérale");
  attendu(/Données copiées/.test(r.texteBouton), "le bouton doit afficher une confirmation temporaire (obtenu : " + r.texteBouton + ", statut : " + r.statut + ")");
  attendu(/copiées dans le presse-papier/.test(r.statut), "la barre de statut doit confirmer la copie");
});

test("presse-papier Excel : la colonne Valeur reprend la formule du classeur", "complexe", async (p, excel) => {
  const r = await p(`
    const l = T.model().links[0];
    const cle = "id:" + l.source + " " + l.target;
    const tsv = T.formatExcelClipboard(undefined, { [cle]: "Approvisionnement!B12*1000" });
    // Index relevé sur l'en-tête : le tableau des nœuds gagne des colonnes.
    // La ligne est retrouvée par ses IDs : les liens sont rangés par filière,
    // colonne, couloir et ordre vertical, pas dans l'ordre du modèle.
    const entetes = tsv.split('\\r\\n')[0].split('\\t');
    const iVal = entetes.indexOf('Valeur du flux');
    const iSrc = entetes.indexOf('ID origine'), iDst = entetes.indexOf('ID destination');
    const trouver = t => t.split('\\r\\n').slice(1).map(x => x.split('\\t'))
        .find(cs => cs[iSrc] === l.source && cs[iDst] === l.target) || [];
    const ligne = trouver(tsv);
    const sansFormule = trouver(T.formatExcelClipboard());
    return { valeur: ligne[iVal], valeurBrute: sansFormule[iVal] };
  `);
  egal(r.valeur, "=Approvisionnement!B12*1000",
    "la formule du classeur doit être collée telle quelle, préfixée de « = »");
  attendu(!/^=/.test(r.valeurBrute),
    "sans formule connue, la valeur calculée reste collée — obtenu : " + r.valeurBrute);
});

test("presse-papier Excel : le bouton va chercher les formules du classeur", "complexe", async (p, excel) => {
  const cle = await p(`const l = T.model().links[0]; return "id:" + l.source + " " + l.target;`);
  excel.formules = { [cle]: "Approvisionnement!B12*1000" };
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    await sleep(60);
    const btn = [...document.querySelectorAll('#sidebar button')]
        .find(b => /Copier les données Excel/.test(b.textContent));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(250);
    const statut = document.getElementById('status').textContent;
    T.setExcelPath(null);
    return { statut };
  `);
  attendu(/1 formule\(s\) conservée\(s\)/.test(r.statut),
    "le statut doit signaler la formule conservée — obtenu : " + r.statut);
});

test("synchro auto désactivée : modifier un nœud n'envoie pas de push automatique vers Excel", "complexe", async (p, excel) => {
  excel.verrou = false;
  excel.ecritures = 0;
  excel.ecrituresLive = 0;
  const r = await p(`
    T.setExcelPath('/tmp/classeur-test.xlsx');
    await sleep(60);
    const src = one('Féverolle');
    await selectNode(src.id);
    await clickPlus();
    await sleep(1500); // attend au-delà de l'ancien délai de 1200ms
    T.setExcelPath(null);
    return { ok: true };
  `);
  egal(excel.ecritures, 0, "aucune écriture fichier ne doit être envoyée automatiquement");
  egal(excel.ecrituresLive, 0, "aucune écriture live ne doit être envoyée automatiquement");
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

test("types : le champ « Type » change la nature du nœud et part dans Excel", "complexe", async p => {
  const r = await p(`
    const cible = nodes().find(n => !T.hidden().includes(n.filiere));
    await selectNode(cible.id);
    await setField('Type', 'industrie');
    await sleep(150);
    const lignes = T.formatExcelClipboard().split('\\r\\n');
    const entetes = lignes[0].split('\\t');
    const iType = entetes.indexOf('Type'), iId = entetes.indexOf('ID');
    const ligne = lignes.slice(1).map(l => l.split('\\t')).find(cs => cs[iId] === cible.id);
    return {
      kind: byId(cible.id).kind,
      industries: nodes().filter(n => n.kind === 'industrie').length,
      colonneType: iType,
      valeurExcel: ligne ? ligne[iType] : null
    };
  `);
  egal(r.kind, "industrie", "le champ doit fixer le type du nœud");
  egal(r.industries, 1, "un seul nœud a changé de type");
  attendu(r.colonneType >= 0, "le tableau des nœuds doit porter une colonne « Type »");
  egal(r.valeurExcel, "Industrie", "le type part dans Excel écrit en clair");
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

test("types : une police propre au type s'applique à l'aperçu et à l'édition", "complexe", async p => {
  const r = await p(`
    const m = T.model();
    const visibles = m.nodes.filter(n => !T.hidden().includes(n.filiere));
    visibles.forEach((n, i) => { n.kind = i % 2 ? 'industrie' : 'produit'; });
    T.refresh();
    await sleep(120);
    await cocher('Industries / étapes', 'Police propre à ce type');
    await reglerCarte('Industries / étapes', 'Graisse', '300');
    await cocher('Industries / étapes', 'Italique');
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

test("étiquettes (aperçu) : « Centré » pose le nom sur le nœud, calé aux colonnes de bord",
  "complexe", async p => {
  const r = await p(`
    await reglerCarte('Étiquettes des nœuds', 'Position', 'centre');
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
  fermetures: 0, ecritures: 0, ecrituresLive: 0, enregistrements: 0,
  formules: {}
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
  ipcMain.handle("excel:formulas", () => ({ ok: true, formules: excelSimule.formules }));
  ipcMain.handle("clipboard:write", (_e, text) => {
    clipboard.writeText(text);
    return { ok: true };
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
      excelSimule.formules = {};
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
