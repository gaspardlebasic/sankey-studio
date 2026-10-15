// Visionneuse de l'export HTML interactif (PLAN-AGREGATION.md, étape 4).
//
// Ce bundle est construit À PART (build.mjs) puis gravé, comme texte, dans
// l'éditeur : l'export l'écrit dans la page qu'il produit. La page s'ouvre
// donc hors ligne, sans Excel ni serveur — un fichier qu'on envoie par mail.
//
// Lecture seule : ⊕ / ⊖, boutons de niveaux, infobulles. Le dessin et les
// commandes sont ceux de l'aperçu du complément (src/renderer/apercu-agrege.ts),
// au code près.

import { FlowModel, SankeyOptions } from "../renderer/types";
import { dessinerAgrege, poserCommandesAgregees, modeleAffiche, aDesNiveaux } from "../renderer/apercu-agrege";
import { commandeCliquee, instantane, animerTransition } from "../renderer/depliage";
import { depliesAuNiveau, nombreDeNiveaux } from "../shared/agregation.js";
import type { Cadre } from "../shared/agregation.js";

/** Ce que l'export écrit dans la page (`<script id="sankey-donnees">`). */
export interface DonneesVisionneuse {
    version: 1;
    titre: string;
    model: FlowModel;
    options: SankeyOptions;
    /** La vue de présentation : les parents dépliés à l'ouverture. */
    deplies: string[];
}

function demarrer(): void {
    const brut = document.getElementById("sankey-donnees");
    const svg = document.getElementById("diagramme") as unknown as SVGSVGElement | null;
    const zone = document.getElementById("zone");
    const niveauxEl = document.getElementById("niveaux");
    if (!brut || !svg || !zone) return;
    const d = JSON.parse(brut.textContent || "{}") as DonneesVisionneuse;
    const model = d.model;
    let deplies = new Set<string>(d.deplies || []);
    let cadres: Cadre[] = [];

    const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

    /** Une infobulle sur chaque nœud : son nom, ce qui le traverse. */
    function infobulles(): void {
        const affiche = modeleAffiche(model, deplies);
        const entree = new Map<string, number>(), sortie = new Map<string, number>();
        const unite = new Map<string, string>();
        affiche.links.forEach(l => {
            entree.set(l.target, (entree.get(l.target) || 0) + l.value);
            sortie.set(l.source, (sortie.get(l.source) || 0) + l.value);
            if (l.unit) { unite.set(l.source, l.unit); unite.set(l.target, l.unit); }
        });
        const noms = new Map(affiche.nodes.map(n => [n.id, n.name]));
        svg!.querySelectorAll("rect[data-id]").forEach(rc => {
            const id = rc.getAttribute("data-id") || "";
            const total = Math.max(entree.get(id) || 0, sortie.get(id) || 0);
            const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
            t.textContent = (noms.get(id) || id) + " — " + fmt(total)
                + (unite.get(id) ? " " + unite.get(id) : "");
            rc.appendChild(t);
        });
    }

    function majNiveaux(): void {
        if (!niveauxEl) return;
        niveauxEl.innerHTML = "";
        const n = aDesNiveaux(model) ? nombreDeNiveaux(model.nodes) : 0;
        niveauxEl.hidden = n < 2;
        if (n < 2) return;
        const parents = new Set(model.nodes.map(x => x.parent).filter(Boolean) as string[]);
        const effectifs = Array.from(deplies).filter(id => parents.has(id));
        const titre = document.createElement("span");
        titre.textContent = "Niveau";
        niveauxEl.appendChild(titre);
        for (let k = 1; k <= n; k++) {
            const voulu = depliesAuNiveau(model.nodes, k);
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = String(k);
            b.dataset.niveau = String(k);
            b.title = k === 1 ? "Tout replier" : k === n ? "Tout déplier" : `Déplier ${k} niveaux`;
            if (voulu.size === effectifs.length && effectifs.every(id => voulu.has(id))) {
                b.classList.add("actif");
            }
            b.addEventListener("click", () => { deplies = voulu; dessiner(true); });
            niveauxEl.appendChild(b);
        }
    }

    function dessiner(animer: boolean): void {
        const avant = animer ? instantane(svg!, cadres) : null;
        const w = Math.max(200, zone!.clientWidth);
        const h = Math.max(200, zone!.clientHeight);
        dessinerAgrege(svg!, model, d.options, deplies, w, h);
        cadres = poserCommandesAgregees(svg!, model, deplies);
        infobulles();
        if (avant) animerTransition(svg!, avant, cadres);
        majNiveaux();
    }

    const basculer = (cible: EventTarget | null): boolean => {
        const c = commandeCliquee(cible);
        if (!c) return false;
        if (c.deplier) deplies.add(c.id);
        else deplies.delete(c.id);
        dessiner(true);
        return true;
    };
    svg.addEventListener("click", e => { basculer(e.target); });
    svg.addEventListener("keydown", e => {
        if ((e.key === "Enter" || e.key === " ") && basculer(e.target)) e.preventDefault();
    });
    let minuteur = 0;
    window.addEventListener("resize", () => {
        clearTimeout(minuteur);
        minuteur = window.setTimeout(() => dessiner(false), 120);
    });
    // Sans niveaux, il n'y a rien à déplier : l'aide ne parle que du survol.
    const aide = document.querySelector(".aide");
    if (aide && !aDesNiveaux(model)) aide.textContent = "Survol : valeurs";
    dessiner(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
else demarrer();
