"use strict";
/**
 * Faux Office.js pour éprouver la SONDE hors d'Excel (phase 6).
 *
 *   npm run serve   puis   http://localhost:8811/sonde-essai.html
 *
 * La sonde est l'instrument de la phase 6 : elle part sur un poste Windows pour
 * répondre aux deux questions qui décident (le poids des messages du tunnel, et
 * `DialogApi 1.2`). Un instrument faux ferait perdre le déplacement — d'où ce
 * banc, qui rejoue le mécanisme complet dans un navigateur ordinaire.
 *
 * Le même fichier sert aux DEUX pages : chargé dans un iframe, il se met en mode
 * « fenêtre » ; chargé dans la page du dessus, en mode « volet ». Le transport
 * est un `postMessage` à la place du canal d'Office.
 *
 * IL MENT SUR UN POINT, volontairement : `window.__limiteFausse` impose un
 * plafond de taille (1 Mo par défaut) qu'Office n'impose peut-être pas. C'est ce
 * qui permet de vérifier que l'échelle de la sonde s'arrête proprement et
 * rapporte le bon palier — dans les deux modes d'échec possibles : `messageChild`
 * qui refuse, et `messageParent` qui part dans le silence.
 */

(function () {
  var dansLaFenetre = window.parent !== window;
  window.__limiteFausse = 1024 * 1024;

  var Succeeded = "succeeded";
  var EventType = {
    DialogMessageReceived: "dialogMessageReceived",
    DialogEventReceived: "dialogEventReceived",
    DialogParentMessageReceived: "dialogParentMessageReceived"
  };

  /* ----------------------------- côté fenêtre ----------------------------- */

  if (dansLaFenetre) {
    var ecoute = null;
    window.addEventListener("message", function (e) {
      if (!e.data || e.data.canal !== "sonde" || e.data.sens !== "vers-fenetre") return;
      if (ecoute) ecoute({ message: e.data.texte });
    });

    window.Office = {
      AsyncResultStatus: { Succeeded: Succeeded, Failed: "failed" },
      EventType: EventType,
      onReady: function (cb) { setTimeout(function () { cb({ host: "Excel", platform: "Faux" }); }, 0); },
      context: {
        ui: {
          messageParent: function (texte) {
            // Trop gros : Office ne dit rien, le volet ne verra qu'un silence.
            // C'est le pire cas, et c'est celui qu'il faut savoir reproduire.
            if (texte.length > window.__limiteFausse) return;
            parent.postMessage({ canal: "sonde", sens: "vers-volet", texte: texte }, "*");
          },
          addHandlerAsync: function (type, handler, cb) {
            if (type === EventType.DialogParentMessageReceived) ecoute = handler;
            setTimeout(function () { cb({ status: Succeeded }); }, 0);
          }
        }
      }
    };
    return;
  }

  /* ------------------------------ côté volet ------------------------------ */

  /** Un classeur minuscule, à la forme que `trouverTableaux` attend. */
  var TABLEAUX = [
    {
      name: "Noeuds", feuille: "Diagramme",
      entetes: ["Filière", "Noeud", "Numéro de colonne d'affichage",
                "Intitulé de la colonne d'affichage", "Ordre vertical d'affichage",
                "Couleur", "ID", "Couloir", "Type"],
      corps: [
        ["Lait", "Production", 1, "Amont", 0, "#e0503f", "n1", 1, "industrie"],
        ["Lait", "Lait cru", 2, "", 0, "#e79a3c", "n2", 1, "produit"],
        ["Lait", "Beurre", 3, "Aval", 0, "#e79a3c", "n3", 1, "produit"]
      ]
    },
    {
      name: "Liens", feuille: "Diagramme",
      entetes: ["Filière", "Origine", "Destination", "Valeur du flux", "Unité",
                "ID origine", "ID destination"],
      corps: [
        ["Lait", "Production", "Lait cru", 5500, "t", "n1", "n2"],
        ["Lait", "Lait cru", "Beurre", 92, "t", "n2", "n3"]
      ]
    }
  ];

  function plage(valeurs) {
    return {
      values: valeurs, formulas: valeurs,
      rowCount: valeurs.length, columnCount: (valeurs[0] || []).length,
      address: "Diagramme!A1", load: function () {}
    };
  }

  window.Excel = {
    run: function (fn) {
      var tables = {
        items: TABLEAUX.map(function (t) {
          return {
            name: t.name, worksheet: { name: t.feuille },
            getHeaderRowRange: function () { return plage([t.entetes]); },
            getDataBodyRange: function () { return plage(t.corps); }
          };
        }),
        load: function () {}
      };
      return fn({ workbook: { tables: tables }, sync: function () { return Promise.resolve(); } });
    }
  };

  /* La fenêtre : un iframe, à la place d'un vrai dialogue Office. */
  var cadre = null;
  var surMessage = null;
  var surEvenement = null;

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.canal !== "sonde" || e.data.sens !== "vers-volet") return;
    if (surMessage) surMessage({ message: e.data.texte });
  });

  function ouvrirCadre(url) {
    cadre = document.createElement("iframe");
    cadre.src = url;
    cadre.title = "Fenêtre de la sonde (fausse)";
    cadre.style.cssText = "position:fixed;right:12px;bottom:12px;width:340px;height:220px;" +
      "border:2px solid rgba(128,128,128,.5);background:Canvas;z-index:99";
    document.body.appendChild(cadre);
    return {
      addEventHandler: function (type, h) {
        if (type === EventType.DialogMessageReceived) surMessage = h;
        if (type === EventType.DialogEventReceived) surEvenement = h;
      },
      messageChild: function (texte) {
        // Trop gros : ici Office lève, et la sonde doit le rapporter tel quel.
        if (texte.length > window.__limiteFausse) {
          throw new Error("faux plafond de " + window.__limiteFausse + " o dépassé");
        }
        cadre.contentWindow.postMessage({ canal: "sonde", sens: "vers-fenetre", texte: texte }, "*");
      },
      close: function () {
        if (cadre) { cadre.remove(); cadre = null; }
        if (surEvenement) surEvenement({ error: 12006 });
      }
    };
  }

  var reglages = {};
  window.Office = {
    AsyncResultStatus: { Succeeded: Succeeded, Failed: "failed" },
    EventType: EventType,
    onReady: function (cb) { setTimeout(function () { cb({ host: "Excel", platform: "Faux" }); }, 0); },
    extensionLifeCycle: { taskpane: { setWidth: function () { /* sans effet, comme hors bornes */ } } },
    context: {
      diagnostics: { host: "Excel", platform: "Faux (navigateur)", version: "banc d'essai" },
      requirements: {
        // Tout est là : c'est le cas nominal. Mets-en un à false pour vérifier
        // que la sonde refuse de mesurer le tunnel (window.__sansDialog = true).
        isSetSupported: function (nom, version) {
          if (window.__sansDialog && nom === "DialogApi" && version === "1.2") return false;
          if (nom === "ExcelApi") return parseFloat(version.slice(2)) <= 21;
          return true;
        }
      },
      document: {
        settings: {
          get: function (k) { return reglages[k]; },
          set: function (k, v) { reglages[k] = v; },
          remove: function (k) { delete reglages[k]; },
          saveAsync: function (cb) { setTimeout(function () { cb({ status: Succeeded }); }, 0); }
        }
      },
      ui: {
        displayDialogAsync: function (url, options, cb) {
          setTimeout(function () { cb({ status: Succeeded, value: ouvrirCadre(url) }); }, 0);
        }
      }
    }
  };
})();
