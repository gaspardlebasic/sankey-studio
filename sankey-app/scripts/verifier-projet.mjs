/**
 * Diagnostic d'un fichier .sankey : cherche les incohérences qui font
 * « dérailler » l'éditeur (identifiants en double, compteur périmé, liens
 * orphelins…). Lecture seule, aucun fichier n'est modifié.
 *
 * Usage : npm run verifier -- "chemin/vers/Fichier.sankey" [autres fichiers…]
 */
import { readFileSync } from "fs";
import { basename } from "path";

const fichiers = process.argv.slice(2);
if (!fichiers.length) {
  console.error('Usage : npm run verifier -- "chemin/vers/Fichier.sankey"');
  process.exit(2);
}

let problemes = 0;

for (const f of fichiers) {
  console.log("\n" + basename(f));
  let p;
  try {
    p = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.log("  ✗ illisible : " + e.message);
    problemes++;
    continue;
  }
  const nodes = (p.model && p.model.nodes) || [];
  const links = (p.model && p.model.links) || [];
  const dire = (ok, msg) => {
    console.log((ok ? "  ok " : "  ✗  ") + msg);
    if (!ok) problemes++;
  };

  const dbl = arr => {
    const vus = new Set(), d = new Set();
    arr.forEach(v => (vus.has(v) ? d.add(v) : vus.add(v)));
    return [...d];
  };

  const idsN = nodes.map(n => n.id);
  const idsL = links.map(l => l.id);
  const dN = dbl(idsN), dL = dbl(idsL);
  dire(!dN.length, dN.length ? `identifiants de nœuds en double : ${dN.join(", ")}` : "identifiants de nœuds uniques");
  dire(!dL.length, dL.length ? `identifiants de liens en double : ${dL.join(", ")}` : "identifiants de liens uniques");

  // Compteur : doit dépasser le plus grand numéro utilisé, sinon les prochains
  // ajouts réattribuent un identifiant existant (liens qui partent au mauvais nœud).
  const nums = [...idsN, ...idsL].map(i => parseInt(String(i).slice(1), 10)).filter(n => !isNaN(n));
  const maxNum = nums.length ? Math.max(...nums) : 0;
  const compteur = p.idCounter || 0;
  dire(compteur > maxNum,
    compteur > maxNum
      ? `compteur d'identifiants sain (${compteur} > ${maxNum})`
      : `compteur périmé : idCounter=${compteur} alors que le plus grand identifiant est ${maxNum} — ` +
        `les prochains ajouts entreraient en collision (corrigé automatiquement à l'ouverture)`);

  const parId = new Set(idsN);
  const orphelins = links.filter(l => !parId.has(l.source) || !parId.has(l.target));
  dire(!orphelins.length,
    orphelins.length ? `${orphelins.length} lien(s) orphelin(s) : ${orphelins.map(l => l.id).join(", ")}`
                     : "tous les liens pointent vers des nœuds existants");

  const paires = links.map(l => l.source + ">" + l.target);
  const dP = dbl(paires);
  dire(!dP.length, dP.length ? `liens en double (même origine/destination) : ${dP.join(", ")}` : "aucun lien en double");

  const noms = dbl(nodes.map(n => n.name));
  if (noms.length) {
    console.log(`  i   noms de nœuds en double : ${noms.join(", ")} — sans danger dans l'app, ` +
                `mais la synchro Excel réconcilie par nom quand l'ID manque`);
  }
  console.log(`  i   ${nodes.length} nœuds, ${links.length} liens, filières : ` +
              [...new Set(nodes.map(n => n.filiere || "(sans)"))].join(", "));
}

console.log(problemes ? `\n${problemes} problème(s) détecté(s).` : "\nAucun problème détecté.");
process.exit(problemes ? 1 : 0);
