/**
 * Entrée de la FENÊTRE D'ÉDITION (phase 4 du PLAN-COMPLEMENT-EXCEL).
 *
 * C'est la même page que le volet à une chose près, et cette chose décide de
 * tout : ici, `Excel.run` n'existe pas. Une fenêtre de dialogue Office ne
 * dispose que de `messageParent` et `isSetSupported`. Elle héberge donc
 * l'éditeur — c'est elle qui a la place, jusqu'à 99,5 % de l'écran — et passe
 * commande au volet pour tout ce qui touche au classeur.
 *
 * L'ORDRE D'AMORÇAGE, qui n'est pas négociable :
 *
 *   1. `Office.onReady` — sans quoi `Office.context.ui` n'existe pas ;
 *   2. brancher l'écoute des messages du volet, et ATTENDRE qu'elle soit posée
 *      (sinon la réponse au « bonjour » arriverait dans le vide) ;
 *   3. poignée de main : capacités et nom du classeur ;
 *   4. `createApp` — qui lit ces capacités de façon synchrone.
 */

import { Mandataire } from "./protocole";
import { installerPontFenetre } from "./pont-fenetre";
import { createApp } from "../renderer/editor";

function annoncer(message: string): void {
  const racine = document.getElementById("app");
  if (racine) racine.textContent = message;
}

/** `addHandlerAsync` est asynchrone : rien ne doit partir avant sa réponse. */
function ecouterLeVolet(mandataire: Mandataire): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    Office.context.ui.addHandlerAsync(
      Office.EventType.DialogParentMessageReceived,
      (arg: any) => {
        if (arg && typeof arg.message === "string") mandataire.recevoir(arg.message);
      },
      (r: Office.AsyncResult<unknown>) => {
        if (r.status === Office.AsyncResultStatus.Succeeded) resoudre();
        else rejeter(new Error((r.error && r.error.message) || "écoute du volet impossible"));
      }
    );
  });
}

function demarrer(): void {
  Office.onReady(async () => {
    const racine = document.getElementById("app");
    if (!racine) return;

    const mandataire = new Mandataire(texte => Office.context.ui.messageParent(texte));
    // Deux pages, deux caches : le volet peut avoir été mis à jour sans la
    // fenêtre. Mieux vaut le dire que se comporter bizarrement (PLAN §9).
    mandataire.surDesaccord(() => annoncer(
      "Le volet et cette fenêtre ne sont pas de la même version de Sankey Studio. "
      + "Ferme cette fenêtre et rouvre-la depuis le volet."));

    try {
      await ecouterLeVolet(mandataire);
      await installerPontFenetre(mandataire);
    } catch (e) {
      annoncer("Cette fenêtre n'a pas pu joindre le volet Excel : "
        + ((e as Error).message || e)
        + ". Vérifie que le volet Sankey Studio est toujours ouvert dans Excel.");
      return;
    }

    createApp(racine);
  });
}

// Même précaution que dans le volet : sans Office.js, la fenêtre ne peut pas
// joindre le volet, et une page blanche n'explique rien.
if (typeof Office === "undefined") {
  annoncer("Sankey Studio n'a pas pu charger Office.js — vérifie la connexion "
    + "Internet, puis referme et rouvre cette fenêtre depuis le volet.");
} else {
  demarrer();
}
