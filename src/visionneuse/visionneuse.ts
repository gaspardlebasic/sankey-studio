// Visionneuse de l'export HTML interactif (PLAN-AGREGATION.md, étape 4).
//
// Ce bundle est construit À PART (build.mjs) puis gravé, comme texte, dans
// l'éditeur : l'export l'écrit dans la page qu'il produit. La page s'ouvre
// donc hors ligne, sans Excel ni serveur — un fichier qu'on envoie par mail.
//
// Lecture seule : ⊕ / ⊖, boutons de niveaux, dévoilement colonne par colonne,
// sélecteur d'année, survol du sous-flux, filtre au clic et infobulles. Le dessin et les
// commandes sont ceux de l'aperçu du complément (src/renderer/apercu-agrege.ts),
// au code près.

import { FlowModel, SankeyOptions } from "../renderer/types";
import {
    dessinerAgrege, poserCommandesAgregees, modeleAffiche, modeleDessine, aDesNiveaux
} from "../renderer/apercu-agrege";
import { commandeCliquee, instantane, animerTransition } from "../renderer/depliage";
import type { Instantane } from "../renderer/depliage";
import { appliquerDevoilement, nombreDeColonnes } from "../renderer/devoilement";
import {
    peindreSousFlux, effacerSousFlux, partsPeintes, fantomeDuDessin, poserFantome
} from "../renderer/sous-flux";
import { sousFlux } from "../shared/sous-flux.js";
import { anneesDistinctes, anneeParDefaut, liensPourAnnee } from "../shared/annees.js";
import { depliesAuNiveau, nombreDeNiveaux, PREFIXE_RESTE } from "../shared/agregation.js";
import type { Cadre } from "../shared/agregation.js";

/** Ce que l'export écrit dans la page (`<script id="sankey-donnees">`). */
export interface DonneesVisionneuse {
    version: 1 | 2;
    titre: string;
    model: FlowModel;
    options: SankeyOptions;
    /** La vue de présentation : les parents dépliés à l'ouverture. */
    deplies: string[];
    /** L'année choisie dans l'aperçu au moment de l'export. */
    annee?: string;
    /** Toutes les années portées par les liens (facultatif : recalculé). */
    annees?: string[];
}

function demarrer(): void {
    const brut = document.getElementById("sankey-donnees");
    const svg = document.getElementById("diagramme") as unknown as SVGSVGElement | null;
    const zone = document.getElementById("zone");
    const niveauxEl = document.getElementById("niveaux");
    const colonnesEl = document.getElementById("colonnes");
    const anneeEl = document.getElementById("annee");
    const sousFluxEl = document.getElementById("sous-flux");
    if (!brut || !svg || !zone) return;
    const d = JSON.parse(brut.textContent || "{}") as DonneesVisionneuse;
    const model = d.model;
    let deplies = new Set<string>(d.deplies || []);
    let cadres: Cadre[] = [];
    /** Dévoilement colonne par colonne : réglage rangé dans l'apparence. */
    const devoilement = d.options.devoilement?.show === true;
    let colonnesRevelees = 2;

    /** Les années du classeur, et celle qu'on dessine. */
    const annees = anneesDistinctes(model.links);
    let annee = d.annee && annees.indexOf(d.annee) >= 0 ? d.annee : anneeParDefaut(annees);

    /** Le modèle de l'année choisie : une seule valeur par couple. */
    const modeleAnnee = (): FlowModel =>
        ({ nodes: model.nodes, links: liensPourAnnee(model.links, annee) });

    const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

    /**
     * Filtre de SOUS-FLUX : les nœuds cliqués, dans l'ordre — le même geste que
     * l'aperçu du complément. Cliquer un nœud resserre le filtre sur ce qui reste
     * à l'écran, recliquer le dernier défait un cran, le vide / Échap / ✕ tout.
     */
    let filtre: string[] = [];

    /** Une infobulle sur chaque nœud : son nom, ce qui le traverse (tel que dessiné). */
    function infobulles(m: FlowModel): void {
        const affiche = filtre.length ? modeleDessine(m, d.options, deplies, filtre)
            : modeleAffiche(m, deplies, d.options);
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

    /* ---- Dévoilement : « Colonnes 2 / 6 », flèches ← → ---- */
    let titreColonnes: HTMLElement | null = null;
    let flecheGauche: HTMLButtonElement | null = null;
    let flecheDroite: HTMLButtonElement | null = null;
    if (colonnesEl) {
        titreColonnes = document.createElement("span");
        titreColonnes.className = "colonnes-titre";
        const groupe = document.createElement("span");
        groupe.className = "colonnes-groupe";
        const fleche = (pas: -1 | 1, texte: string, titre: string) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = texte;
            b.title = titre;
            b.addEventListener("click", () => reveler(pas));
            groupe.appendChild(b);
            return b;
        };
        flecheGauche = fleche(-1, "←", "Masquer la dernière colonne (flèche gauche)");
        flecheDroite = fleche(1, "→", "Afficher la colonne suivante (flèche droite)");
        colonnesEl.append(titreColonnes, groupe);
    }

    /** Ramène un nombre de colonnes montrées dans [2, total]. */
    const borner = (n: number, total: number) => Math.max(2, Math.min(Math.max(2, total), n));

    function majColonnes(): void {
        if (!colonnesEl) return;
        const total = devoilement ? Math.max(2, nombreDeColonnes(svg!)) : 0;
        const actif = devoilement && total > 2;
        colonnesEl.hidden = !actif;
        if (!actif) return;
        const montre = borner(colonnesRevelees, total);
        if (titreColonnes) titreColonnes.textContent = `Colonnes ${montre} / ${total}`;
        if (flecheGauche) flecheGauche.disabled = montre <= 2;
        if (flecheDroite) flecheDroite.disabled = montre >= total;
    }

    /* ---- Dimension année : « Année [2024] », s'il y a plusieurs années ---- */
    let anneeSelect: HTMLSelectElement | null = null;
    let signatureAnnees = "";
    if (anneeEl) {
        const label = document.createElement("label");
        label.htmlFor = "annee-select";
        label.textContent = "Année";
        anneeSelect = document.createElement("select");
        anneeSelect.id = "annee-select";
        anneeEl.append(label, anneeSelect);
        anneeSelect.addEventListener("change", () => {
            annee = anneeSelect!.value;
            dessiner(true);
        });
    }

    function majAnnees(): void {
        if (!anneeEl || !anneeSelect) return;
        anneeEl.hidden = annees.length <= 1;
        if (anneeEl.hidden) return;
        const signature = annees.join("\u0000");
        if (signature !== signatureAnnees) {
            anneeSelect.innerHTML = "";
            annees.forEach(a => {
                const o = document.createElement("option");
                o.value = a;
                o.textContent = a;
                anneeSelect!.appendChild(o);
            });
            signatureAnnees = signature;
        }
        anneeSelect.value = annee;
    }

    /** Nœud survolé : son sous-flux est peint par-dessus le dessin. */
    let survol: string | null = null;
    function survoler(e: MouseEvent): void {
        const cible = e.target instanceof Element
            ? e.target.closest("g[data-label-for], rect[data-id]") : null;
        const id = cible && (cible.getAttribute("data-label-for") || cible.getAttribute("data-id"));
        const visible = id && cible && cible.getAttribute("visibility") !== "hidden" ? id : null;
        if (visible === survol) return;
        survol = visible;
        if (!visible) { effacerSousFlux(svg!); return; }
        const dessine = modeleDessine(modeleAnnee(), d.options, deplies, filtre);
        if (!dessine.nodes.some(n => n.id === visible)) { effacerSousFlux(svg!); return; }
        peindreSousFlux(svg!, visible, sousFlux(dessine, visible));
    }

    /** Relevé fait AVANT de poser ou défaire un filtre : d'où part l'animation. */
    type Transition = { avant: Instantane; fantome: SVGGElement | null };

    function dessiner(animer: boolean, transition?: Transition): void {
        const avant = transition ? transition.avant : animer ? instantane(svg!, cadres) : null;
        // Le survol portait sur l'ancien dessin : il part avec lui.
        if (survol !== null) { effacerSousFlux(svg!); survol = null; }
        const w = Math.max(200, zone!.clientWidth);
        const h = Math.max(200, zone!.clientHeight);
        const base = modeleAnnee();
        dessinerAgrege(svg!, base, d.options, deplies, w, h, "#ffffff", filtre);
        // Le dessin est celui du diagramme entier : le dévoilement ne fait que
        // masquer les colonnes qui ne sont pas encore montrées.
        if (devoilement) {
            colonnesRevelees = borner(colonnesRevelees, nombreDeColonnes(svg!));
            appliquerDevoilement(svg!, colonnesRevelees);
        }
        cadres = poserCommandesAgregees(svg!, base, deplies);
        infobulles(base);
        if (avant) animerTransition(svg!, avant, cadres);
        if (transition && transition.fantome) poserFantome(svg!, transition.fantome);
        majNiveaux();
        majSousFlux();
        majAnnees();
        majColonnes();
    }

    /** Une colonne de plus (1) ou de moins (-1), sans redessiner le Sankey. */
    function reveler(pas: number): void {
        if (!devoilement) return;
        const total = Math.max(2, nombreDeColonnes(svg!));
        const avant = borner(colonnesRevelees, total);
        const apres = borner(avant + pas, total);
        if (apres === avant) return;
        // La bande de survol d'une colonne cachée n'aurait plus de sens.
        if (survol !== null) { effacerSousFlux(svg!); survol = null; }
        colonnesRevelees = apres;
        appliquerDevoilement(svg!, apres, apres > avant ? avant : undefined);
        // Les ⊕ / ⊖ ne se posent que sur les nœuds montrés : ils suivent.
        cadres = poserCommandesAgregees(svg!, modeleAnnee(), deplies);
        majColonnes();
    }

    /* ---- Filtre au clic : « Sous-flux : A › B ✕ » ---- */
    const nomsParId = new Map(model.nodes.map(n => [n.id, n.name]));
    function nomDessine(id: string): string {
        const nom = nomsParId.get(id);
        if (nom !== undefined) return nom;
        const parent = id.startsWith(PREFIXE_RESTE) ? nomsParId.get(id.slice(PREFIXE_RESTE.length)) : undefined;
        return parent !== undefined ? `${parent} (non détaillé)` : id;
    }

    function majSousFlux(): void {
        if (!sousFluxEl) return;
        sousFluxEl.innerHTML = "";
        sousFluxEl.hidden = !filtre.length;
        if (!filtre.length) return;
        const titre = document.createElement("span");
        titre.className = "sous-flux-titre";
        titre.textContent = "Sous-flux : " + filtre.map(nomDessine).join(" › ");
        titre.title = "Le diagramme ne montre que ce qui passe par ce nœud. "
            + "Cliquer un autre nœud resserre le filtre ; cliquer le dernier, le vide ou Échap le défait.";
        const fermer = document.createElement("button");
        fermer.type = "button";
        fermer.textContent = "✕";
        fermer.title = "Revoir tout le diagramme (Échap)";
        fermer.addEventListener("click", () => filtrer(null));
        sousFluxEl.append(titre, fermer);
    }

    /** Pose (id) ou retire (null) un cran de filtre, puis redessine en animant. */
    function filtrer(id: string | null): void {
        const precedent = filtre;
        if (id === null) filtre = [];
        else if (filtre[filtre.length - 1] === id) filtre = filtre.slice(0, -1);
        else filtre = [...filtre, id];
        if (filtre.length === precedent.length && filtre.every((x, i) => x === precedent[i])) return;
        /* Resserrer : le global s'efface (fantôme) pendant que le sous-flux
           grandit depuis ses bandes du survol. Desserrer : ce qui revient
           apparaît en fondu. Même mécanique que l'aperçu (editor.ts). */
        const resserre = id !== null && filtre[filtre.length - 1] === id;
        const transition: Transition = {
            avant: instantane(svg!, cadres, resserre ? partsPeintes(svg!) : undefined),
            fantome: resserre ? fantomeDuDessin(svg!) : null
        };
        dessiner(false, transition);
    }

    /** Le nœud visé par un clic : son étiquette ou sa boîte, s'il est montré. */
    function noeudCible(cible: EventTarget | null): string | null {
        const el = cible instanceof Element ? cible.closest("g[data-label-for], rect[data-id]") : null;
        if (!el || el.getAttribute("visibility") === "hidden") return null;
        return el.getAttribute("data-label-for") || el.getAttribute("data-id");
    }

    const basculer = (cible: EventTarget | null): boolean => {
        const c = commandeCliquee(cible);
        if (!c) return false;
        if (c.deplier) deplies.add(c.id);
        else deplies.delete(c.id);
        dessiner(true);
        return true;
    };
    svg.addEventListener("click", e => {
        if (basculer(e.target)) return;
        // Un nœud filtre sur son sous-flux ; le vide défait tout.
        filtrer(noeudCible(e.target));
    });
    svg.addEventListener("keydown", e => {
        if ((e.key === "Enter" || e.key === " ") && basculer(e.target)) e.preventDefault();
    });
    svg.addEventListener("mouseover", survoler);
    svg.addEventListener("mouseleave", () => {
        if (survol === null) return;
        survol = null;
        effacerSousFlux(svg);
    });
    window.addEventListener("keydown", e => {
        if (e.key === "Escape" && filtre.length) { filtrer(null); return; }
        if (!devoilement) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        reveler(e.key === "ArrowRight" ? 1 : -1);
    });
    let minuteur = 0;
    window.addEventListener("resize", () => {
        clearTimeout(minuteur);
        minuteur = window.setTimeout(() => dessiner(false), 120);
    });
    // L'aide ne promet que ce que la page sait faire.
    const aide = document.querySelector(".aide");
    if (aide) {
        const parties: string[] = [];
        if (devoilement) parties.push("← → colonnes");
        if (annees.length > 1) parties.push("année : choisir");
        if (aDesNiveaux(model)) parties.push("⊕ déplier · ⊖ replier");
        parties.push("survol : valeurs · clic : filtrer");
        aide.textContent = parties.join(" · ");
    }
    dessiner(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
else demarrer();
