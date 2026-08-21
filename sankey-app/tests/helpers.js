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
 * Sélectionne un nœud par un clic réel sur sa boîte.
 * On l'amène d'abord dans la fenêtre : elementFromPoint ne voit que ce qui est
 * réellement affiché, un nœud hors champ renverrait le panneau latéral.
 */
const selectNodeReel = async id => {
    const wrap = document.querySelector('#canvas-wrap');
    const n = byId(id);
    const vue = wrap.getBoundingClientRect();
    if (n.x + NODE_W > wrap.scrollLeft + vue.width - 20) {
        wrap.scrollLeft = Math.max(0, n.x + NODE_W - vue.width + 60);
    } else if (n.x < wrap.scrollLeft + 20) {
        wrap.scrollLeft = Math.max(0, n.x - 40);
    }
    await sleep(60);
    const p = centerOf(id);
    await clicReel(p.x, p.y);
    return T.selection();
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
    i.dispatchEvent(new Event('input', { bubbles: true }));
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
`;
