/**
 * Fonctions injectées dans la page avant chaque assertion des tests.
 * Elles pilotent l'éditeur comme le ferait l'utilisatrice : de vrais évènements
 * souris/clavier, jamais d'appel direct aux fonctions internes.
 */
module.exports = `
const T = window.__sankeyTest;
const NODE_W = 132, NODE_H = 38;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canvasRect = () => document.querySelector('#canvas').getBoundingClientRect();

/** Nœuds du modèle (tous, y compris ceux d'une filière masquée). */
const nodes = () => T.model().nodes;
const links = () => T.model().links;
const byId = id => nodes().find(n => n.id === id);
const named = name => nodes().filter(n => n.name === name);
const one = name => {
    const l = named(name);
    if (l.length !== 1) throw new Error(l.length + ' nœuds nommés ' + JSON.stringify(name));
    return l[0];
};

/** Élément SVG d'un nœud, retrouvé par son identifiant de modèle. */
const elOf = id => document.querySelector('#canvas .edit-node[data-id="' + id + '"]');
/**
 * Centre du nœud tel qu'il est RÉELLEMENT peint à l'écran.
 * Surtout ne pas recalculer à partir du modèle : on reproduirait la formule de
 * l'application, et un décalage entre ce qui est dessiné et ce qui est testé
 * passerait inaperçu. C'est le point de vue de l'utilisatrice qui compte.
 */
const centerOf = id => {
    const el = elOf(id);
    if (!el) throw new Error('nœud non rendu : ' + id);
    const r = el.querySelector('.node-box').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const clickAt = (x, y, el) => (el || document.elementFromPoint(x, y))
    .dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));

/** Sélectionne un nœud par un vrai clic sur sa boîte. */
const selectNode = async id => {
    const p = centerOf(id), el = elOf(id);
    if (!el) throw new Error('nœud non rendu : ' + id);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: p.x, clientY: p.y }));
    // Le mousedown peut avoir reconstruit le canevas : l'élément d'origine est
    // alors détaché. Comme le navigateur, on remet le relâchement sur la fenêtre
    // (c'est là qu'écoute le glisser) et le clic sur l'élément retrouvé.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: p.x, clientY: p.y }));
    const apres = elOf(id) || el;
    apres.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y }));
    await sleep(60);
    return T.selection();
};

/** Tire un lien depuis un point de liaison du nœud sélectionné vers un autre nœud. */
const dragLink = async (dir, targetId, opts) => {
    const g = [...document.querySelectorAll('#canvas .link-dot')][dir === 'in' ? 0 : 1];
    if (!g) throw new Error('aucun point de liaison visible');
    const dr = g.querySelector('.link-dot-circle').getBoundingClientRect();
    const depart = { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 };
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true,
        clientX: depart.x, clientY: depart.y }));
    const p = (opts && opts.point) || centerOf(targetId);
    // Deux déplacements : le premier sort du point, le second atteint la cible.
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x - 20, clientY: p.y }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y }));
    await sleep(60);
    const over = document.querySelector('#canvas .edit-node.drop-target');
    const overId = over ? over.dataset.id : null;
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: p.x, clientY: p.y }));
    await sleep(90);
    return { highlighted: overId };
};

/** Déplace un nœud de cols colonnes et rows rangées. */
const dragNode = async (id, cols, rows) => {
    const el = elOf(id), p = centerOf(id);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: p.x, clientY: p.y }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
        clientX: p.x + cols * 210 + 4, clientY: p.y + rows * 60 + 2 }));
    await sleep(80);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(140);
};

/** Glisser un nœud d'un nombre de PIXELS donné (pour viser une bande précise). */
const dragNodePx = async (id, dx, dy) => {
    const el = elOf(id), p = centerOf(id);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: p.x, clientY: p.y }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
        clientX: p.x + dx, clientY: p.y + dy }));
    await sleep(80);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(140);
};

/** Boîte peinte d'un nœud, en coordonnées écran. */
const boxOf = id => elOf(id).querySelector('.node-box').getBoundingClientRect();

/**
 * Clic RÉEL : la cible est re-résolue par elementFromPoint à chaque évènement,
 * comme le fait le navigateur. Indispensable pour détecter un élément remplacé
 * entre le mousedown et le mouseup — le clic ne parvient alors jamais au nœud.
 */
const clicReel = async (x, y) => {
    // Un vrai clic retire d'abord le focus du champ en cours : c'est ce blur qui
    // déclenche la validation, donc la reconstruction du panneau et du canevas.
    const actif = document.activeElement;
    if (actif && (actif.tagName === 'INPUT' || actif.tagName === 'SELECT')) {
        actif.blur();
        await sleep(60);
    }
    const evt = (type) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
        return el;
    };
    evt('mousedown');
    await sleep(10);
    evt('mouseup');
    evt('click');
    await sleep(80);
};
/**
 * Amène un nœud dans la fenêtre : elementFromPoint ne voit que ce qui est
 * réellement affiché, un nœud hors champ renverrait le panneau latéral.
 */
const amenerEnVue = async id => {
    const wrap = document.querySelector('#canvas-wrap');
    const n = byId(id);
    const vue = wrap.getBoundingClientRect();
    if (n.x + NODE_W > wrap.scrollLeft + vue.width - 20) {
        wrap.scrollLeft = Math.max(0, n.x + NODE_W - vue.width + 60);
    } else if (n.x < wrap.scrollLeft + 20) {
        wrap.scrollLeft = Math.max(0, n.x - 40);
    }
    await sleep(60);
};

/** Sélectionne un nœud par un clic réel sur sa boîte. */
const selectNodeReel = async id => {
    await amenerEnVue(id);
    const p = centerOf(id);
    await clicReel(p.x, p.y);
    return T.selection();
};

/** Pastille de couleur d'un nœud, telle qu'elle est peinte. */
const pastilleDe = id => {
    const el = elOf(id);
    if (!el) throw new Error('nœud non rendu : ' + id);
    return el.querySelector('.node-color-dot').getBoundingClientRect();
};

/**
 * Clic RÉEL sur la pastille de couleur d'un nœud. La cible est re-résolue par
 * elementFromPoint : c'est ce qui éprouve que la pastille est bien attrapable,
 * et pas seulement que son gestionnaire est branché.
 */
const clicPastille = async id => {
    await amenerEnVue(id);
    const r = pastilleDe(id);
    await clicReel(r.left + r.width / 2, r.top + r.height / 2);
};

/** Champ du panneau latéral, repéré par son intitulé. */
const field = label => {
    const f = [...document.querySelectorAll('#sidebar .field')]
        .find(x => x.querySelector('span') && x.querySelector('span').textContent.trim() === label);
    return f ? f.querySelector('input, select') : null;
};
const setField = async (label, value) => {
    const i = field(label);
    if (!i) throw new Error('champ introuvable : ' + label);
    i.focus();
    i.value = value;
    // Une liste déroulante n'émet jamais 'input' : ses gestionnaires écoutent 'change'.
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await sleep(80);
};
/**
 * Saisit un texte caractère par caractère dans un champ du panneau.
 * Indispensable : un gestionnaire qui reconstruit le panneau à chaque frappe
 * détruit le champ en cours d'édition : une affectation de value en un seul
 * coup ne le verrait pas.
 */
const typeField = async (label, texte) => {
    let i = field(label);
    if (!i) throw new Error('champ introuvable : ' + label);
    i.focus();
    i.value = '';
    for (const ch of texte) {
        const actif = document.activeElement;
        if (!actif || actif.tagName !== 'INPUT') return { perduApres: i.value, focus: false };
        actif.value = actif.value + ch;
        actif.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(15);
    }
    const fin = field(label);
    return { saisi: fin ? fin.value : null, focus: document.activeElement === fin };
};
/**
 * Carte repliable du panneau, ouverte, repérée par son titre.
 * À re-demander après CHAQUE modification : le panneau est reconstruit à chaque
 * changement d'option, l'élément précédent est alors détaché.
 */
const carteDuPanneau = async nom => {
    const d = [...document.querySelectorAll('#sidebar details')]
        .find(x => x.querySelector('summary').textContent.indexOf(nom) >= 0);
    if (!d) throw new Error('carte introuvable : ' + nom);
    d.open = true;
    await sleep(60);
    return d;
};
/** Bascule une case à cocher d'une carte, repérée par son intitulé exact. */
const cocher = async (nomCarte, label) => {
    const c = await carteDuPanneau(nomCarte);
    const f = [...c.querySelectorAll('.field.check')]
        .find(x => x.textContent.trim() === label);
    if (!f) throw new Error('case introuvable : ' + label);
    f.querySelector('input').click();
    await sleep(140);
};
/** Presse une bascule du groupe « Style » d'une carte ([G], [i], [AA]). */
const basculer = async (nomCarte, titre) => {
  const c = await carteDuPanneau(nomCarte);
  const b = [...c.querySelectorAll('.style-toggle')].find(x => x.title === titre);
  if (!b) throw new Error('bascule introuvable : ' + titre);
  b.click();
  await sleep(140);
};
/** Renseigne un champ (nombre, texte ou liste) d'une carte. */
const reglerCarte = async (nomCarte, label, valeur) => {
    const c = await carteDuPanneau(nomCarte);
    const f = [...c.querySelectorAll('.field')]
        .find(x => x.querySelector('span') && x.querySelector('span').textContent.trim() === label);
    const i = f && f.querySelector('input, select');
    if (!i) throw new Error('champ introuvable : ' + label);
    i.focus();
    i.value = valeur;
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await sleep(140);
};
/** Bascule Édition <-> Aperçu par la vraie bascule segmentée de la barre d'outils. */
const versApercu = async () => {
    document.querySelectorAll('#toolbar .segmented .seg')[1].click();
    await sleep(300);
};
const versEdition = async () => {
    document.querySelectorAll('#toolbar .segmented .seg')[0].click();
    await sleep(150);
};
/** Rectangles de nœuds réellement peints dans l'aperçu, avec leur type. */
const rectsApercu = () => [...document.querySelectorAll('#canvas rect[data-id]')].map(rc => {
    const b = rc.getBoundingClientRect();
    return { id: rc.getAttribute('data-id'), kind: rc.getAttribute('data-kind'),
             gauche: b.left, droite: b.right, haut: b.top, bas: b.bottom,
             largeur: b.width, hauteur: b.height };
});
/**
 * Nœuds de l'aperçu que le ruban d'un lien recouvre RÉELLEMENT.
 * On interroge la géométrie peinte du tracé (isPointInFill), jamais une formule
 * de l'application : c'est le seul moyen de voir ce que voit l'utilisatrice.
 * Les deux nœuds d'extrémité du lien sont exclus — le ruban part de leur bord.
 */
const noeudsRecouverts = (sourceId, cibleId) => {
    const ruban = document.querySelector(
        '#canvas path:not(.lien-bio)[data-source="' + sourceId + '"][data-target="'
        + cibleId + '"]');
    if (!ruban) throw new Error('ruban non peint : ' + sourceId + ' -> ' + cibleId);
    const num = (el, a) => parseFloat(el.getAttribute(a));
    // Cette version de Chromium n'accepte qu'un SVGPoint, pas un DOMPoint.
    const pt = ruban.ownerSVGElement.createSVGPoint();
    const dedans = (x, y) => { pt.x = x; pt.y = y; return ruban.isPointInFill(pt); };
    return [...document.querySelectorAll('#canvas rect[data-id]')]
        .filter(rc => {
            const id = rc.getAttribute('data-id');
            if (id === sourceId || id === cibleId) return false;
            const x = num(rc, 'x'), y = num(rc, 'y');
            const w = num(rc, 'width'), h = num(rc, 'height');
            // Quadrillage strictement intérieur : un point posé sur le bord
            // serait ambigu, et « frôler » n'est pas « recouvrir ».
            for (let i = 1; i <= 5; i++) {
                for (let j = 1; j <= 5; j++) {
                    if (dedans(x + w * i / 6, y + h * j / 6)) return true;
                }
            }
            return false;
        })
        .map(rc => rc.getAttribute('data-id'));
};
/**
 * Rastérise l'aperçu TEL QU'IL EST PEINT et rend le contexte 2D.
 * Une mosaïque est un motif SVG : le DOM ne dit que l'intention (« ce nœud est
 * rempli par url(#…) »), et seule la peinture dit ce que voit l'utilisatrice.
 * C'est le chemin de l'export PNG de l'application (SVG -> Image -> canvas).
 */
const rasteriserApercu = async () => {
    const svg = document.querySelector('#canvas');
    const w = Math.round(parseFloat(svg.getAttribute('width')));
    const h = Math.round(parseFloat(svg.getAttribute('height')));
    const url = 'data:image/svg+xml;charset=utf-8,'
        + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = new Image();
    await new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('aperçu illisible'));
        img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx;
};
/**
 * La mosaïque d'un nœud, telle qu'elle est PEINTE.
 * On lit deux colonnes de pixels distantes d'un carré : dans un damier elles
 * sont en opposition de phase (là où l'une est blanche, l'autre porte la
 * couleur du nœud) — c'est ce qui distingue un carrelage de simples rayures.
 * Les pixels de bord entre deux carrés sont lissés par le navigateur : chaque
 * pixel est ramené au plus proche des deux tons attendus, le reste comptant
 * comme « autre ».
 */
const mesurerMosaique = async (id, couleurNoeud, taille) => {
    const rc = document.querySelector('#canvas rect[data-id="' + id + '"]');
    if (!rc) throw new Error('nœud non peint dans l aperçu : ' + id);
    const num = a => parseFloat(rc.getAttribute(a));
    const ctx = await rasteriserApercu();
    const cible = couleurNoeud.replace('#', '').match(/../g).map(h => parseInt(h, 16));
    const proche = (d, r, g, b) =>
        Math.abs(d[0] - r) + Math.abs(d[1] - g) + Math.abs(d[2] - b) <= 24;
    const haut = Math.ceil(num('y')) + 1;
    const bas = Math.floor(num('y') + num('height')) - 1;
    const colonne = x => {
        const tons = [];
        for (let y = haut; y <= bas; y++) {
            const d = ctx.getImageData(Math.round(x), y, 1, 1).data;
            if (proche(d, 255, 255, 255)) tons.push('blanc');
            else if (proche(d, cible[0], cible[1], cible[2])) tons.push('noeud');
            else tons.push('autre');
        }
        return tons;
    };
    const milieu = num('x') + num('width') / 2;
    // Deux colonnes séparées d'un carré, prises de part et d'autre du milieu.
    const gauche = colonne(milieu - taille / 2);
    const droite = colonne(milieu + taille / 2);
    const plages = [];
    gauche.forEach(ton => {
        const derniere = plages[plages.length - 1];
        if (derniere && derniere.ton === ton) derniere.n++;
        else plages.push({ ton: ton, n: 1 });
    });
    const nets = gauche.map((t, i) => [t, droite[i]])
        .filter(p => p[0] !== 'autre' && p[1] !== 'autre');
    return {
        plages: plages,
        hauteur: gauche.length,
        blancs: gauche.filter(t => t === 'blanc').length,
        couleurs: gauche.filter(t => t === 'noeud').length,
        autres: gauche.filter(t => t === 'autre').length,
        // Part des hauteurs où les deux colonnes portent des tons DIFFÉRENTS :
        // 1 pour un damier, 0 pour des rayures verticales.
        opposition: nets.length ? nets.filter(p => p[0] !== p[1]).length / nets.length : 0,
        pointsCompares: nets.length
    };
};
/**
 * Part du ruban que le bandeau bio recouvre RÉELLEMENT.
 * On balaie une verticale juste à la sortie du nœud d'origine et on compte les
 * points qui tombent dans le tracé peint — du ruban, puis du bandeau. Jamais un
 * calcul refait d'après le modèle : c'est la peinture qui doit être jugée.
 */
const mesurerBio = ruban => {
    const src = ruban.getAttribute('data-source');
    const dst = ruban.getAttribute('data-target');
    const bio = document.querySelector(
        '#canvas path.lien-bio[data-source="' + src + '"][data-target="' + dst + '"]');
    const rc = document.querySelector('#canvas rect[data-id="' + src + '"]');
    if (!rc) throw new Error('origine non peinte dans l aperçu : ' + src);
    const x = parseFloat(rc.getAttribute('x')) + parseFloat(rc.getAttribute('width')) + 1;
    // Cette version de Chromium n'accepte qu'un SVGPoint, pas un DOMPoint.
    const pt = ruban.ownerSVGElement.createSVGPoint();
    pt.x = x;
    const dedans = (el, y) => { pt.y = y; return el.isPointInFill(pt); };
    const b = ruban.getBBox();
    let nR = 0, nB = 0, hautR = null, hautB = null;
    for (let y = b.y; y <= b.y + b.height; y += 0.1) {
        if (dedans(ruban, y)) { nR++; if (hautR === null) hautR = y; }
        if (bio && dedans(bio, y)) { nB++; if (hautB === null) hautB = y; }
    }
    return {
        lien: src + ' -> ' + dst,
        part: nR ? nB / nR : 0,
        // Le bandeau part du BORD SUPÉRIEUR du ruban : les deux commencent au
        // même endroit, sinon on verrait un vert flottant au milieu du flux.
        ecartHaut: hautB === null ? null : Math.abs(hautB - hautR)
    };
};
/** Les rubans les plus épais de l'aperçu, chacun mesuré par mesurerBio. */
const rubansMesures = n => [...document.querySelectorAll('#canvas path[data-source]')]
    .filter(el => !el.classList.contains('lien-bio'))
    .map(el => ({ el, h: el.getBBox().height }))
    .sort((a, b) => b.h - a.h)
    .slice(0, n)
    .map(x => mesurerBio(x.el));
/** Tracés des rubans (hors bandeaux), pour vérifier qu'ils n'ont pas bougé. */
const tracesRubans = () => [...document.querySelectorAll('#canvas path[data-source]')]
    .filter(el => !el.classList.contains('lien-bio'))
    .map(el => el.getAttribute('d'));

/** Étiquettes de l'aperçu réellement peintes, avec la place qu'elles occupent. */
const etiquettesApercu = () => [...document.querySelectorAll('#canvas text[data-label-for]')]
    .map(t => {
        const b = t.getBoundingClientRect();
        return { id: t.getAttribute('data-label-for'), kind: t.getAttribute('data-kind'),
                 gauche: b.left, droite: b.right, haut: b.top, bas: b.bottom,
                 milieuX: b.left + b.width / 2, milieuY: b.top + b.height / 2 };
    });
/**
 * Nœuds de la VUE D'ÉDITION que le tracé d'un lien recouvre RÉELLEMENT.
 * Un lien d'édition est un TRAIT, pas une surface : on échantillonne le tracé
 * peint (getPointAtLength) et l'on regarde quelles boîtes de nœuds il traverse.
 * Jamais une formule refaite d'après le modèle — c'est la peinture qui compte.
 * Les deux extrémités sont exclues : le trait part de leur bord.
 */
const noeudsTraversesEdition = (sourceId, cibleId) => {
    const trace = document.querySelector('#canvas .edit-link .link-line[data-source="'
        + sourceId + '"][data-target="' + cibleId + '"]');
    if (!trace) throw new Error('lien non tracé : ' + sourceId + ' -> ' + cibleId);
    const r0 = canvasRect();
    const L = trace.getTotalLength();
    const pts = [];
    for (let i = 0; i <= 600; i++) {
        const p = trace.getPointAtLength(L * i / 600);
        pts.push({ x: r0.left + p.x, y: r0.top + p.y });
    }
    return [...document.querySelectorAll('#canvas .edit-node')]
        .filter(el => el.dataset.id !== sourceId && el.dataset.id !== cibleId)
        .filter(el => {
            const b = el.querySelector('.node-box').getBoundingClientRect();
            return pts.some(p => p.x >= b.left && p.x <= b.right
                              && p.y >= b.top && p.y <= b.bottom);
        })
        .map(el => el.dataset.id);
};
/** Haut de la boîte peinte de chaque nœud d'une colonne, par identifiant. */
const hautsDeColonne = col => {
    const out = {};
    [...document.querySelectorAll('#canvas .edit-node')].forEach(el => {
        const n = byId(el.dataset.id);
        if (n && n.column === col) out[n.id] = Math.round(boxOf(n.id).top);
    });
    return out;
};
const clickPlus = async () => {
    const g = document.querySelector('#canvas .plus-handle');
    if (!g) throw new Error('bouton + absent');
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(140);
};
/** Description lisible d'un lien, pour les messages d'échec. */
const desc = l => {
    const s = byId(l.source), t = byId(l.target);
    return (s ? s.name : '?') + ' -> ' + (t ? t.name : '?');
};

/* ------------------------------- export ------------------------------- */

/**
 * Intercepte le fichier que l'export remet au navigateur, au lieu de le laisser
 * partir en téléchargement — Electron ouvrirait une boîte d'enregistrement et
 * le test resterait planté dessus.
 *
 * On saisit le blob lui-même : c'est le SEUL endroit où l'on voit ce qui est
 * réellement exporté. Mesurer la taille sur le modèle reproduirait la formule
 * de l'app, et un écart entre le choix et le fichier passerait inaperçu.
 */
const capterExport = () => {
    const urlOrigine = URL.createObjectURL;
    const clicOrigine = HTMLAnchorElement.prototype.click;
    const fichiers = [];
    let dernier = null;
    URL.createObjectURL = blob => { dernier = blob; return 'blob:essai'; };
    HTMLAnchorElement.prototype.click = function () {
        fichiers.push({ nom: this.download, blob: dernier });
    };
    return {
        fichiers,
        rendre: () => {
            URL.createObjectURL = urlOrigine;
            HTMLAnchorElement.prototype.click = clicOrigine;
        }
    };
};

/** Dimensions annoncées par le SVG exporté, telles qu'elles y sont écrites. */
const tailleDuSvgExporte = async blob => {
    const texte = await blob.text();
    const w = texte.match(/width="([0-9.]+)"/);
    const h = texte.match(/height="([0-9.]+)"/);
    return { width: w ? Number(w[1]) : null, height: h ? Number(h[1]) : null };
};

/** Ouvre le menu d'un bouton d'export (« PNG » ou « SVG ») et rend ses lignes. */
const ouvrirMenuExport = async format => {
    const b = [...document.querySelectorAll('#toolbar button.export-btn')]
        .find(x => x.textContent.trim() === format);
    if (!b) throw new Error('bouton export introuvable : ' + format);
    b.click();
    await sleep(100);
    return [...document.querySelectorAll('.mp-pop .mp-item')].map(it => ({
        label: it.querySelector('.mp-label').textContent.trim(),
        detail: it.querySelector('.mp-detail') ? it.querySelector('.mp-detail').textContent.trim() : ''
    }));
};

/** Clique une ligne du menu ouvert, et laisse l'export aboutir. */
const choisirDansMenu = async label => {
    const it = [...document.querySelectorAll('.mp-pop .mp-item')]
        .find(x => x.querySelector('.mp-label').textContent.trim() === label);
    if (!it) throw new Error('ligne de menu introuvable : ' + label);
    it.click();
    await sleep(500);
};

/** Coche ou décoche une filière du panneau « Filières affichées ». */
const basculerFiliere = async nom => {
    const s = [...document.querySelectorAll('#sidebar .panel')]
        .find(x => x.querySelector('h3') && x.querySelector('h3').textContent.trim() === 'Filières affichées');
    if (!s) throw new Error('panneau des filières absent');
    const f = [...s.querySelectorAll('.field.check')].find(x => x.textContent.trim() === nom);
    if (!f) throw new Error('filière introuvable : ' + nom);
    f.querySelector('input').click();
    await sleep(200);
};
`;
