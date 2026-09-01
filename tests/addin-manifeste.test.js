"use strict";
/**
 * Tests des MANIFESTES du complément (phase 5).
 *
 * Pourquoi ce fichier existe : un manifeste invalide ne se découvre qu'au pire
 * moment — Excel refuse de charger le complément, sans dire pourquoi, et sur le
 * poste de quelqu'un d'autre. Deux fautes ont réellement été commises ici en
 * écrivant la phase 5, toutes deux dans un COMMENTAIRE : **XML interdit deux
 * tirets consécutifs dans un commentaire**, et une ligne de commande avec des
 * options longues (`-- --sonde`) casse donc le fichier entier.
 *
 * Ce n'est pas un validateur XML général — il n'y en a pas dans les dépendances,
 * et en écrire un serait pire que le mal. C'est un contrôle des pièges connus et
 * des règles PROPRES à ce projet, que jamais aucun validateur générique ne
 * vérifierait : une seule origine pour toutes les pages, HTTPS partout, et un
 * jeu d'exigences volontairement minimal.
 *
 * Usage : node tests/addin-manifeste.test.js  [filtre]
 */

const fs = require("fs");

const filtre = process.argv[2];
let ok = 0;
const echecs = [];
function test(nom, fn) {
  if (filtre && !nom.toLowerCase().includes(filtre.toLowerCase())) return;
  try { fn(); ok++; console.log("  ok    " + nom); }
  catch (e) { echecs.push(nom); console.log("  ÉCHEC " + nom + "\n      " + ((e && e.message) || e)); }
}
function attendu(c, m) { if (!c) throw new Error(m); }

const MANIFESTES = ["src/addin/manifest.xml", "src/addin/manifest-sonde.xml"];

/* --------------------------- outils de lecture --------------------------- */

/** Les commentaires XML, avec leur numéro de ligne pour un message utile. */
function commentaires(xml) {
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(xml))) {
    out.push({ texte: m[1], ligne: xml.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Le document privé de ses commentaires : le reste des contrôles s'y applique. */
function sansCommentaires(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function valeurs(xml, attribut) {
  return [...xml.matchAll(new RegExp(attribut + '="([^"]*)"', "g"))].map(m => m[1]);
}

function balise(xml, nom) {
  const m = xml.match(new RegExp("<" + nom + ">([^<]*)</" + nom + ">"));
  return m && m[1];
}

/* ------------------------------- les tests ------------------------------- */

console.log("\nmanifestes — bien-formé\n");

for (const chemin of MANIFESTES) {
  const xml = fs.readFileSync(chemin, "utf8");

  test(chemin + " — aucun « -- » dans un commentaire", () => {
    for (const c of commentaires(xml)) {
      attendu(!c.texte.includes("--"),
        `ligne ${c.ligne} : un commentaire XML ne peut pas contenir deux tirets consécutifs.\n` +
        "      Excel refuserait de charger le complément. Reformule la ligne de commande.");
    }
  });

  test(chemin + " — les balises se referment", () => {
    const corps = sansCommentaires(xml).replace(/<\?[\s\S]*?\?>/g, "");
    const pile = [];
    const re = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    let m;
    while ((m = re.exec(corps))) {
      const [, fermante, nom, , autoFermante] = m;
      if (autoFermante) continue;
      if (fermante) {
        const attendue = pile.pop();
        attendu(attendue === nom, `</${nom}> ferme <${attendue || "rien"}>`);
      } else {
        pile.push(nom);
      }
    }
    attendu(pile.length === 0, "balises jamais refermées : " + pile.join(", "));
  });

  test(chemin + " — identité et version présentes", () => {
    attendu(/^[0-9a-f-]{36}$/.test(balise(xml, "Id") || ""), "l'Id doit être un GUID");
    attendu(/^\d+\.\d+\.\d+\.\d+$/.test(balise(xml, "Version") || ""),
      "la Version doit avoir quatre nombres — Office ne recharge que si elle change");
  });
}

console.log("\nmanifestes — règles du projet\n");

for (const chemin of MANIFESTES) {
  const xml = sansCommentaires(fs.readFileSync(chemin, "utf8"));
  const urls = [...valeurs(xml, "DefaultValue"), ...(xml.match(/<AppDomain>([^<]*)<\/AppDomain>/g) || [])]
    .map(v => v.replace(/<\/?AppDomain>/g, ""))
    .filter(v => /^https?:/.test(v));

  test(chemin + " — tout est en HTTPS", () => {
    attendu(urls.length > 0, "aucune URL trouvée — le test ne prouverait rien");
    for (const u of urls) attendu(u.startsWith("https://"), "URL en clair : " + u);
  });

  test(chemin + " — une seule origine", () => {
    // La règle qui rend la fenêtre d'édition possible : Office exige que toutes
    // les pages d'un complément partagent une origine, sous-domaine compris.
    const origines = new Set(urls.map(u => new URL(u).origin));
    attendu(origines.size === 1, "plusieurs origines : " + [...origines].join(", "));
  });

  test(chemin + " — jeu d'exigences minimal", () => {
    // Déclarer 1.7 ici empêcherait le complément de se charger DU TOUT sur un
    // Excel plus ancien, au lieu de le laisser tourner en mode dégradé.
    const sets = [...xml.matchAll(/<Set\s+Name="([^"]+)"\s+MinVersion="([^"]+)"/g)];
    attendu(sets.length > 0, "aucun jeu d'exigences déclaré");
    for (const [, nom, version] of sets) {
      attendu(nom === "ExcelApi" && version === "1.1",
        `${nom} ${version} déclaré : seul ExcelApi 1.1 doit l'être, le reste se sonde ` +
        "à l'exécution avec isSetSupported");
    }
  });
}

test("le complément déclare bien son AppDomain", () => {
  const xml = sansCommentaires(fs.readFileSync("src/addin/manifest.xml", "utf8"));
  const source = valeurs(xml, "DefaultValue").find(v => v.endsWith("/index.html"));
  attendu(source, "SourceLocation introuvable");
  const origine = new URL(source).origin;
  attendu(xml.includes("<AppDomain>" + origine + "</AppDomain>"),
    "AppDomains doit déclarer " + origine + " — la fenêtre d'édition y vit aussi");
});

console.log(`\n${ok}/${ok + echecs.length} tests passés`);
if (echecs.length) { console.log("Échecs : " + echecs.join(", ")); process.exit(1); }
