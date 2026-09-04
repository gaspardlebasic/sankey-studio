/**
 * Entrée de la coquille « complément Office » — le VOLET.
 *
 * Depuis la phase 4, le volet ne montre plus l'éditeur : il est le courtier
 * d'une **fenêtre d'édition** séparée (`fenetre.html`), qui, elle, occupe
 * l'écran. Le volet garde Office.js, le classeur, et l'état.
 *
 * DEUX CHEMINS, décidés à l'exécution :
 *
 *  - `DialogApi 1.2` présent — le cas normal : volet courtier + fenêtre.
 *    C'est 1.2 qui apporte `messageChild` (volet → fenêtre) ; sans elle le
 *    tunnel serait à sens unique, donc inutilisable.
 *  - `DialogApi 1.2` absent — repli de compatibilité : l'éditeur reste dans le
 *    volet, comme avant la phase 4. Étroit, mais entier.
 *
 * L'ORDRE est tout, dans les deux cas : le renderer lit `window.desktop` dès
 * `createApp` (capacités, nom du classeur). On ne démarre donc qu'une fois
 * Office prêt ET le pont posé. Un simple `<script>` avant le bundle ne
 * suffirait pas : `Office.onReady` est asynchrone.
 */

import { installerPont, elargirVolet, supporte } from "./pont";
import type { Pont } from "./pont";
import { diagrammePresent, initialiserClasseur } from "./excel-office";
import { CourtierVolet, JEU_FENETRE, type Etat } from "./courtier-volet";
import { dateBuildLisible } from "./date-build";
import { createApp } from "../renderer/editor";

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Un message à la place de tout le reste : on n'ira pas plus loin. */
function annoncer(message: string): void {
  const panneau = element("courtier");
  if (panneau) panneau.hidden = true;
  const racine = element("app");
  if (!racine) return;
  racine.hidden = false;
  racine.textContent = message;
  // La version compte SURTOUT ici : « c'est pourtant corrigé » et « Excel sert
  // encore l'ancienne page » se présentent sous le même message d'échec.
  const date = dateBuildLisible();
  if (!date) return;
  const ligne = document.createElement("p");
  ligne.className = "build-note";
  ligne.textContent = "Version du " + date;
  racine.appendChild(ligne);
}

/**
 * La date de construction du complément, en bas du volet.
 *
 * Posée dès le démarrage, avant même de savoir si Excel répond : c'est
 * justement quand quelque chose cloche qu'on veut savoir quelle version est
 * servie. Sans date gravée (bundle fabriqué hors `build.mjs`), la ligne reste
 * cachée plutôt que de mentir.
 */
function montrerDateBuild(): void {
  const ligne = element("courtier-build");
  if (!ligne) return;
  const date = dateBuildLisible();
  if (!date) return;
  ligne.textContent = "Version du " + date;
  ligne.hidden = false;
}

/* --------------------------- volet courtier --------------------------- */

/** Ce que le volet dit de chaque état de la fenêtre. */
const PHRASES: Record<Etat, string> = {
  fermee: "La fenêtre d'édition est fermée.",
  ouverture: "Ouverture de la fenêtre d'édition…",
  ouverte: "L'édition se fait dans la fenêtre. Ce volet la relie au classeur.",
  erreur: ""            // remplacée par le motif, toujours fourni
};

function montrerCourtier(pont: Pont, nomClasseur: string, evenements: boolean): CourtierVolet | null {
  const panneau = element("courtier");
  const racine = element("app");
  const bouton = element<HTMLButtonElement>("courtier-ouvrir");
  const ligneEtat = element("courtier-etat");
  const ligneClasseur = element("courtier-classeur");
  if (!panneau || !bouton || !ligneEtat) return null;

  if (racine) racine.hidden = true;
  panneau.hidden = false;
  if (ligneClasseur) ligneClasseur.textContent = nomClasseur;

  const synchro = element("courtier-synchro");
  if (synchro && !evenements) {
    synchro.hidden = false;
    synchro.textContent = "Cette version d'Excel ne signale pas les modifications "
      + "(ExcelApi 1.7 absent) : relis le classeur depuis la fenêtre d'édition.";
  }

  const courtier = new CourtierVolet({
    pont,
    // Les capacités déclarées par le pont, telles quelles : c'est le volet qui
    // sait ce qu'Excel permet ici, pas la fenêtre.
    accueil: () => ({ capacites: pont.capacites, nomClasseur, evenements }),
    surEtat: (etat, motif) => {
      ligneEtat.textContent = motif || PHRASES[etat];
      ligneEtat.classList.toggle("erreur", etat === "erreur");
      bouton.hidden = etat === "ouverte" || etat === "ouverture";
      bouton.textContent = etat === "erreur" ? "Réessayer" : "Ouvrir la fenêtre d'édition";
    }
  });

  bouton.addEventListener("click", () => courtier.ouvrir());
  return courtier;
}

/**
 * Le classeur n'a pas de quoi porter un diagramme : on propose de le préparer
 * au lieu d'ouvrir un éditeur qui n'aurait rien à montrer.
 *
 * Ce bouton vit dans le VOLET, pas dans la fenêtre d'édition, et c'est
 * délibéré. Il touche au classeur, donc à Office.js, que seul le volet tient ;
 * le faire depuis la fenêtre voudrait dire élargir le contrat
 * `window.desktop` — qui décrit ce dont le RENDERER a besoin — et faire
 * traverser le tunnel à une opération que le renderer n'utilisera jamais. Le
 * volet est aussi le seul des deux à être visible à ce moment-là : la fenêtre
 * n'est pas encore ouverte.
 *
 * `apres` reprend le démarrage normal une fois le classeur prêt.
 */
function proposerAmorce(apres: () => void): void {
  const bloc = element("courtier-amorce");
  const bouton = element<HTMLButtonElement>("courtier-initialiser");
  const ouvrir = element<HTMLButtonElement>("courtier-ouvrir");
  const etat = element("courtier-etat");
  if (!bloc || !bouton) { apres(); return; }   // page incomplète : ne pas bloquer

  bloc.hidden = false;
  if (ouvrir) ouvrir.hidden = true;

  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    bouton.textContent = "Préparation…";
    const r = await initialiserClasseur();
    if (!r.ok && !r.deja) {
      // Un refus est une information, pas une panne : on la montre et on
      // laisse réessayer — l'utilisatrice peut aller corriger dans Excel.
      bouton.disabled = false;
      bouton.textContent = "Réessayer";
      if (etat) {
        etat.textContent = r.error || "Préparation impossible.";
        etat.classList.add("erreur");
      }
      return;
    }
    if (etat) { etat.textContent = ""; etat.classList.remove("erreur"); }
    bloc.hidden = true;
    if (ouvrir) ouvrir.hidden = false;
    apres();
  });
}

/* ------------------------------ démarrage ------------------------------ */

function demarrer(): void {
  Office.onReady(async info => {
    if (!element("app")) return;
    if (info.host !== Office.HostType.Excel) {
      annoncer("Sankey Studio fonctionne dans Excel.");
      return;
    }

    let pont: Pont;
    let nomClasseur: string;
    let evenements: boolean;
    try {
      ({ pont, nomClasseur, evenements } = await installerPont());
    } catch (e) {
      annoncer("Impossible de joindre le classeur : " + ((e as Error).message || e));
      return;
    }

    if (!supporte(JEU_FENETRE)) {
      // Repli : l'éditeur dans le volet, comme avant la phase 4. Le canevas y
      // est à l'étroit (phase 0 §G) mais tout fonctionne.
      console.warn("Sankey Studio : DialogApi 1.2 absent — l'éditeur reste dans le volet.");
      const racine = element("app")!;
      const dansLeVolet = () => { racine.hidden = false; createApp(racine); elargirVolet(); };
      // L'amorce vaut ici aussi : c'est le même classeur nu, et le même remède.
      if (!(await diagrammePresent())) {
        const panneau = element("courtier");
        const ouvrir = element("courtier-ouvrir");
        const ligneClasseur = element("courtier-classeur");
        if (panneau) panneau.hidden = false;
        if (ouvrir) ouvrir.hidden = true;
        if (ligneClasseur) ligneClasseur.textContent = nomClasseur;
        proposerAmorce(() => { if (panneau) panneau.hidden = true; dansLeVolet(); });
        return;
      }
      dansLeVolet();
      return;
    }

    const courtier = montrerCourtier(pont, nomClasseur, evenements);
    if (!courtier) { annoncer("Page du volet incomplète."); return; }

    // Un classeur nu n'a rien à éditer : on propose de le préparer, et la
    // fenêtre n'ouvre qu'après. Ouvrir d'abord donnerait un éditeur vide
    // annonçant « classeur illisible » par-dessus tout l'écran, avec le seul
    // remède — le volet — caché dessous.
    if (!(await diagrammePresent())) {
      proposerAmorce(() => courtier.ouvrir());
      return;
    }

    // Confort du bureau : la fenêtre s'ouvre seule. Sur Excel pour le web, une
    // ouverture sans clic est refusée — le bouton prend alors le relais.
    courtier.ouvrir();
  });
}

// La version se pose AVANT tout le reste, et sans rien demander à Excel : elle
// ne dépend que du bundle qu'on est en train d'exécuter. C'est ce qui la rend
// lisible même quand la suite échoue.
montrerDateBuild();

// office.js vient d'Internet (c'est la règle du modèle Office) : hors ligne il
// manque, et la page resterait blanche sans rien dire. Le risque est assumé
// (PLAN §7), mais il doit s'expliquer.
if (typeof Office === "undefined") {
  annoncer("Sankey Studio n'a pas pu charger Office.js — vérifie la connexion "
    + "Internet, puis referme et rouvre le volet.");
} else {
  demarrer();
}
