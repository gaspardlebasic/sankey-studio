// Export PowerPoint : une diapositive où le diagramme se dévoile colonne par
// colonne, au clic ou aux flèches du diaporama.
//
// Le diagramme n'est PAS redessiné en formes PowerPoint : il est découpé en
// calques d'images PNG transparentes, posés au même endroit, et chaque colonne
// au-delà des deux premières reçoit une animation d'entrée « Fondu » déclenchée
// au clic. → / Espace avancent, ← recule : c'est PowerPoint qui s'en charge.
//
// Pourquoi des calques par CONTENEUR et pas une image par colonne : l'ordre de
// superposition. Le moteur dessine tous les rubans, puis tous les nœuds, puis
// toutes les étiquettes (engine.ts, gLinks … gHeaders). Une image « colonne 3 »
// posée au-dessus d'une image « colonne 2 » recouvrirait de ses rubans les
// étiquettes de la colonne 2. On coupe donc chaque conteneur en calques (un par
// étape) et on empile conteneur après conteneur : l'ordre d'empilement des
// images reproduit celui du SVG, et l'ordre des clics, lui, est indépendant.
//
// Le .pptx est écrit à la main (XML + zip sans compression) : pas de
// dépendance, et le paquet minimal tient en quelques parties.

/** Une image de la diapositive : ce qu'elle montre, et à quel clic. */
export interface CalqueSvg {
    /** 0 = visible d'emblée ; k ≥ 1 = apparaît au k-ième clic. */
    etape: number;
    /** Nom de la forme dans PowerPoint (volet Sélection). */
    nom: string;
    /** Le SVG complet, réduit à ce calque (le reste en `visibility="hidden"`). */
    svg: string;
}

/** Colonnes montrées d'emblée — comme à l'écran et dans l'export HTML. */
const COLONNES_DE_DEPART = 2;

/**
 * Découpe un dessin (portant ses repères `data-layer`) en calques.
 *
 * Le SVG est modifié le temps de la sérialisation, puis rendu tel quel.
 * Rendus dans l'ordre d'EMPILEMENT (du fond vers le dessus).
 */
export function calquesDevoilement(svg: SVGSVGElement): { calques: CalqueSvg[]; clics: number } {
    const serialiser = () => new XMLSerializer().serializeToString(svg);

    // Les éléments de colonne « de tête » : un repère dans un élément déjà
    // repéré suit son parent.
    const tetes = Array.from(svg.querySelectorAll("[data-layer]"))
        .filter(el => !el.parentElement || !el.parentElement.closest("[data-layer]"))
        .map(el => ({ el, couche: Number(el.getAttribute("data-layer")) }))
        .filter(t => isFinite(t.couche));

    let colonnes = 0;
    tetes.forEach(t => { colonnes = Math.max(colonnes, t.couche + 1); });
    const depart = Math.min(COLONNES_DE_DEPART, colonnes);
    const clics = Math.max(0, colonnes - depart);
    const etapeDe = (couche: number) => couche < depart ? 0 : couche - depart + 1;

    // Conteneurs, dans l'ordre du document = ordre d'empilement.
    const conteneurs: Element[] = [];
    tetes.forEach(t => {
        const c = t.el.parentElement as Element;
        if (!conteneurs.includes(c)) conteneurs.push(c);
    });

    const calques: CalqueSvg[] = [];

    // Le fond : tout ce qui n'appartient à aucune colonne (titres, couloirs…).
    tetes.forEach(t => t.el.setAttribute("visibility", "hidden"));
    calques.push({ etape: 0, nom: "Fond", svg: serialiser() });
    tetes.forEach(t => t.el.removeAttribute("visibility"));

    svg.setAttribute("visibility", "hidden");
    conteneurs.forEach((c, i) => {
        for (let etape = 0; etape <= clics; etape++) {
            const montres = tetes.filter(t => t.el.parentElement === c && etapeDe(t.couche) === etape);
            if (!montres.length) continue;
            montres.forEach(t => t.el.setAttribute("visibility", "visible"));
            calques.push({
                etape,
                nom: (etape === 0 ? "Colonnes 1-" + depart : "Colonne " + (depart + etape))
                    + " · calque " + (i + 1),
                svg: serialiser()
            });
            montres.forEach(t => t.el.removeAttribute("visibility"));
        }
    });
    svg.removeAttribute("visibility");

    return { calques, clics };
}

/* ------------------------------ Le paquet ------------------------------ */

export interface CalquePng {
    etape: number;
    nom: string;
    png: Uint8Array;
}

/** Diapositive 16:9, en EMU (914 400 par pouce). */
const DIAPO_L = 12192000;
const DIAPO_H = 6858000;
/** Durée du fondu d'une colonne, en ms. */
const DUREE_FONDU = 500;

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT = "application/vnd.openxmlformats-officedocument.";
const ENTETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_PRES = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

function xmlEchappe(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rels(liste: [string, string, string][]): string {
    return ENTETE + `<Relationships xmlns="${NS_PKG}">`
        + liste.map(([id, type, cible]) =>
            `<Relationship Id="${id}" Type="${type}" Target="${cible}"/>`).join("")
        + "</Relationships>";
}

const ARBRE_VIDE =
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
    + '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/**
 * Le .pptx : une diapositive, les calques posés plein cadre (le dessin centré,
 * proportions gardées), les étapes ≥ 1 en fondu au clic.
 */
export function construirePptx(o: {
    titre: string;
    largeur: number;
    hauteur: number;
    calques: CalquePng[];
}): Uint8Array {
    const k = Math.min(DIAPO_L / o.largeur, DIAPO_H / o.hauteur);
    const cx = Math.round(o.largeur * k);
    const cy = Math.round(o.hauteur * k);
    const x = Math.round((DIAPO_L - cx) / 2);
    const y = Math.round((DIAPO_H - cy) / 2);

    // Formes : id 2, 3, … ; relations d'image rId2, rId3, … (rId1 = la mise en page).
    const formes = o.calques.map((c, i) => ({ ...c, id: i + 2, rid: "rId" + (i + 2), media: `image${i + 1}.png` }));
    const images = formes.map(f =>
        `<p:pic><p:nvPicPr><p:cNvPr id="${f.id}" name="${xmlEchappe(f.nom)}"/>`
        + '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        + `<p:blipFill><a:blip r:embed="${f.rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
        + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
        + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    ).join("");

    const slide = ENTETE + `<p:sld ${NS_PRES}><p:cSld><p:spTree>${ARBRE_VIDE}${images}</p:spTree></p:cSld>`
        + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
        + chronologie(formes)
        + "</p:sld>";

    const fichiers: [string, string | Uint8Array][] = [
        ["[Content_Types].xml", typesDeContenu()],
        ["_rels/.rels", rels([
            ["rId1", REL + "officeDocument", "ppt/presentation.xml"],
            ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
            ["rId3", REL + "extended-properties", "docProps/app.xml"]
        ])],
        ["docProps/core.xml", ENTETE
            + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
            + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
            + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            + `<dc:title>${xmlEchappe(o.titre)}</dc:title><dc:creator>Sankey Studio</dc:creator>`
            + `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>`
            + "</cp:coreProperties>"],
        ["docProps/app.xml", ENTETE
            + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            + "<Application>Sankey Studio</Application><Slides>1</Slides></Properties>"],
        ["ppt/presentation.xml", ENTETE + `<p:presentation ${NS_PRES}>`
            + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            + '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>'
            + `<p:sldSz cx="${DIAPO_L}" cy="${DIAPO_H}"/><p:notesSz cx="6858000" cy="9144000"/>`
            + "</p:presentation>"],
        ["ppt/_rels/presentation.xml.rels", rels([
            ["rId1", REL + "slideMaster", "slideMasters/slideMaster1.xml"],
            ["rId2", REL + "slide", "slides/slide1.xml"],
            ["rId3", REL + "presProps", "presProps.xml"],
            ["rId4", REL + "viewProps", "viewProps.xml"],
            ["rId5", REL + "theme", "theme/theme1.xml"],
            ["rId6", REL + "tableStyles", "tableStyles.xml"]
        ])],
        ["ppt/presProps.xml", ENTETE + `<p:presentationPr ${NS_PRES}/>`],
        ["ppt/viewProps.xml", ENTETE + `<p:viewPr ${NS_PRES}/>`],
        ["ppt/tableStyles.xml", ENTETE
            + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`],
        ["ppt/theme/theme1.xml", theme()],
        ["ppt/slideMasters/slideMaster1.xml", ENTETE + `<p:sldMaster ${NS_PRES}>`
            + '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
            + `<p:spTree>${ARBRE_VIDE}</p:spTree></p:cSld>`
            + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"'
            + ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"'
            + ' hlink="hlink" folHlink="folHlink"/>'
            + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
            + "<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>"
            + "</p:sldMaster>"],
        ["ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([
            ["rId1", REL + "slideLayout", "../slideLayouts/slideLayout1.xml"],
            ["rId2", REL + "theme", "../theme/theme1.xml"]
        ])],
        ["ppt/slideLayouts/slideLayout1.xml", ENTETE + `<p:sldLayout ${NS_PRES} type="blank" preserve="1">`
            + `<p:cSld name="Vide"><p:spTree>${ARBRE_VIDE}</p:spTree></p:cSld>`
            + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"],
        ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([
            ["rId1", REL + "slideMaster", "../slideMasters/slideMaster1.xml"]
        ])],
        ["ppt/slides/slide1.xml", slide],
        ["ppt/slides/_rels/slide1.xml.rels", rels([
            ["rId1", REL + "slideLayout", "../slideLayouts/slideLayout1.xml"],
            ...formes.map(f => [f.rid, REL + "image", "../media/" + f.media] as [string, string, string])
        ])],
        ...formes.map(f => ["ppt/media/" + f.media, f.png] as [string, Uint8Array])
    ];
    return zipper(fichiers);
}

/**
 * La chronologie des animations : un clic par étape, et à chaque clic toutes
 * les images de l'étape en fondu, ensemble (la première « au clic », les
 * autres « avec la précédente »).
 */
function chronologie(formes: { etape: number; id: number }[]): string {
    const etapes = Array.from(new Set(formes.map(f => f.etape).filter(e => e > 0))).sort((a, b) => a - b);
    if (!etapes.length) return "";
    let id = 3;
    const clics = etapes.map(e => {
        const effets = formes.filter(f => f.etape === e).map((f, i) => {
            const idEffet = id++, idSet = id++, idFondu = id++;
            const cible = `<p:tgtEl><p:spTgt spid="${f.id}"/></p:tgtEl>`;
            return `<p:par><p:cTn id="${idEffet}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold"`
                + ` nodeType="${i === 0 ? "clickEffect" : "withEffect"}">`
                + '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
                + `<p:set><p:cBhvr><p:cTn id="${idSet}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>`
                + `${cible}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>`
                + '<p:to><p:strVal val="visible"/></p:to></p:set>'
                + `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${idFondu}" dur="${DUREE_FONDU}"/>`
                + `${cible}</p:cBhvr></p:animEffect>`
                + "</p:childTnLst></p:cTn></p:par>";
        }).join("");
        const idClic = id++, idGroupe = id++;
        return `<p:par><p:cTn id="${idClic}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>`
            + `<p:par><p:cTn id="${idGroupe}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
            + effets
            + "</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>";
    }).join("");
    return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
        + '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
        + clics
        + "</p:childTnLst></p:cTn>"
        + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
        + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
        + "</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>";
}

function typesDeContenu(): string {
    const pres = CT + "presentationml.";
    const o = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
    return ENTETE + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Default Extension="png" ContentType="image/png"/>'
        + o("/ppt/presentation.xml", pres + "presentation.main+xml")
        + o("/ppt/slideMasters/slideMaster1.xml", pres + "slideMaster+xml")
        + o("/ppt/slideLayouts/slideLayout1.xml", pres + "slideLayout+xml")
        + o("/ppt/slides/slide1.xml", pres + "slide+xml")
        + o("/ppt/theme/theme1.xml", CT + "theme+xml")
        + o("/ppt/presProps.xml", pres + "presProps+xml")
        + o("/ppt/viewProps.xml", pres + "viewProps+xml")
        + o("/ppt/tableStyles.xml", pres + "tableStyles+xml")
        + o("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml")
        + o("/docProps/app.xml", CT + "extended-properties+xml")
        + "</Types>";
}

/** Le thème minimal qu'exige le masque (couleurs, polices, styles). */
function theme(): string {
    const couleurs: [string, string][] = [
        ["dk2", "44546A"], ["lt2", "E7E6E6"], ["accent1", "4472C4"], ["accent2", "ED7D31"],
        ["accent3", "A5A5A5"], ["accent4", "FFC000"], ["accent5", "5B9BD5"], ["accent6", "70AD47"],
        ["hlink", "0563C1"], ["folHlink", "954F72"]
    ];
    const plein = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    const trois = (s: string) => s + s + s;
    return ENTETE + `<a:theme xmlns:a="${NS_A}" name="Sankey Studio"><a:themeElements>`
        + '<a:clrScheme name="Sankey Studio">'
        + '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
        + '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
        + couleurs.map(([n, v]) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`).join("")
        + "</a:clrScheme>"
        + '<a:fontScheme name="Sankey Studio">'
        + '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
        + "</a:fontScheme>"
        + '<a:fmtScheme name="Sankey Studio">'
        + `<a:fillStyleLst>${trois(plein)}</a:fillStyleLst>`
        + `<a:lnStyleLst>${trois('<a:ln w="6350">' + plein + "</a:ln>")}</a:lnStyleLst>`
        + `<a:effectStyleLst>${trois("<a:effectStyle><a:effectLst/></a:effectStyle>")}</a:effectStyleLst>`
        + `<a:bgFillStyleLst>${trois(plein)}</a:bgFillStyleLst>`
        + "</a:fmtScheme></a:themeElements></a:theme>";
}

/* ------------------------------ Le zip ------------------------------ */

let tableCrc: Uint32Array | null = null;

function crc32(octets: Uint8Array): number {
    if (!tableCrc) {
        tableCrc = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            tableCrc[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < octets.length; i++) crc = tableCrc[(crc ^ octets[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Archive zip SANS compression (méthode 0, « stored ») : les PNG le sont déjà,
 * et le XML est petit. Noms en UTF-8 (bit 11).
 */
export function zipper(fichiers: [string, string | Uint8Array][]): Uint8Array {
    const enc = new TextEncoder();
    const morceaux: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let decalage = 0;
    fichiers.forEach(([nom, contenu]) => {
        const n = enc.encode(nom);
        const d = typeof contenu === "string" ? enc.encode(contenu) : contenu;
        const crc = crc32(d);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint16(10, 0, true);
        local.setUint16(12, 0x21, true); // 1980-01-01
        local.setUint32(14, crc, true);
        local.setUint32(18, d.length, true);
        local.setUint32(22, d.length, true);
        local.setUint16(26, n.length, true);
        local.setUint16(28, 0, true);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, 0, true);
        c.setUint16(14, 0x21, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, d.length, true);
        c.setUint32(24, d.length, true);
        c.setUint16(28, n.length, true);
        c.setUint32(42, decalage, true);
        morceaux.push(new Uint8Array(local.buffer), n, d);
        central.push(new Uint8Array(c.buffer), n);
        decalage += 30 + n.length + d.length;
    });
    const tailleCentral = central.reduce((s, m) => s + m.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, fichiers.length, true);
    fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, tailleCentral, true);
    fin.setUint32(16, decalage, true);
    const tout = [...morceaux, ...central, new Uint8Array(fin.buffer)];
    const out = new Uint8Array(tout.reduce((s, m) => s + m.length, 0));
    let p = 0;
    tout.forEach(m => { out.set(m, p); p += m.length; });
    return out;
}
