/**
 * Point d'entrée du complément Sankey Studio pour ONLYOFFICE Spreadsheet Editor.
 */

import { installerPontOnlyOffice } from "./pont-onlyoffice";
import { diagrammePresent, initialiserClasseur } from "./excel-onlyoffice";
import { createApp } from "../renderer/editor";

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function annoncer(message: string): void {
  const racine = element("app");
  if (!racine) return;
  racine.innerHTML = "";
  const p = document.createElement("p");
  p.className = "message-info";
  p.textContent = message;
  racine.appendChild(p);
}

function proposerInitialisation(surPret: () => void): void {
  const racine = element("app");
  if (!racine) { surPret(); return; }

  racine.innerHTML = "";
  const conteneur = document.createElement("div");
  conteneur.className = "amorce-onlyoffice";
  conteneur.style.padding = "32px";
  conteneur.style.maxWidth = "600px";
  conteneur.style.margin = "40px auto";
  conteneur.style.fontFamily = "var(--font-family, system-ui, -apple-system, sans-serif)";
  conteneur.style.textAlign = "center";

  const titre = document.createElement("h2");
  titre.textContent = "Bienvenue dans Sankey Studio";
  titre.style.marginBottom = "16px";

  const description = document.createElement("p");
  description.textContent =
    "Ce classeur ne contient pas encore les tableaux requis pour le diagramme de flux " +
    "(tableaux « Nœuds » et « Liens » sur l'onglet Diagramme).";
  description.style.color = "#555";
  description.style.lineHeight = "1.5";
  description.style.marginBottom = "24px";

  const bouton = document.createElement("button");
  bouton.textContent = "Préparer le classeur";
  bouton.className = "primary-button";
  bouton.style.padding = "10px 24px";
  bouton.style.fontSize = "15px";
  bouton.style.fontWeight = "600";
  bouton.style.backgroundColor = "#2b6cb0";
  bouton.style.color = "#fff";
  bouton.style.border = "none";
  bouton.style.borderRadius = "6px";
  bouton.style.cursor = "pointer";

  const msgErreur = document.createElement("p");
  msgErreur.style.color = "#c53030";
  msgErreur.style.marginTop = "16px";

  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    bouton.textContent = "Préparation en cours…";
    msgErreur.textContent = "";

    const res = await initialiserClasseur();
    if (!res.ok && res.statut !== "deja_la") {
      bouton.disabled = false;
      bouton.textContent = "Réessayer";
      msgErreur.textContent = res.message || "Impossible de préparer le classeur.";
      return;
    }

    racine.innerHTML = "";
    surPret();
  });

  conteneur.appendChild(titre);
  conteneur.appendChild(description);
  conteneur.appendChild(bouton);
  conteneur.appendChild(msgErreur);
  racine.appendChild(conteneur);
}

async function demarrer(): Promise<void> {
  const racine = element("app");
  if (!racine) return;

  try {
    await installerPontOnlyOffice();
  } catch (e) {
    annoncer("Impossible de communiquer avec ONLYOFFICE : " + ((e as Error).message || e));
    return;
  }

  const present = await diagrammePresent();
  if (!present) {
    proposerInitialisation(() => {
      createApp(racine);
    });
  } else {
    createApp(racine);
  }
}

// ONLYOFFICE initialise le plugin via Asc.plugin.init
if (typeof window !== "undefined") {
  window.Asc = window.Asc || {};
  window.Asc.plugin = window.Asc.plugin || {};

  window.Asc.plugin.init = function () {
    demarrer();
  };

  // Fermeture ou bouton d'action dans le pied de la fenêtre ONLYOFFICE
  window.Asc.plugin.button = function (id: number) {
    if (id === -1) {
      // Fermeture de la fenêtre modale
      if (typeof window.Asc?.plugin?.executeCommand === "function") {
        window.Asc.plugin.executeCommand("close", "");
      }
    }
  };
}
