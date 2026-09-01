/**
 * Ce que les deux coquilles du complément savent faire SANS Excel.
 *
 * Le volet et la fenêtre d'édition (phase 4) partagent ces bouts-là : ils ne
 * touchent ni au classeur ni à Office.js, donc ils n'ont aucune raison de
 * traverser le tunnel (`src/addin/protocole.ts`) — la fenêtre les exécute
 * elle-même, et c'est autant de moins à sérialiser.
 */

/**
 * Le presse-papier de la webview Office refuse parfois l'API asynchrone (elle
 * exige le focus). Le repli `execCommand` marche là où l'autre échoue : on ne
 * signale l'échec que si les deux ont raté, sinon le renderer annoncerait un
 * échec pour une copie réussie.
 */
export async function copierPressePapier(texte: string): Promise<{ ok: true }> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texte);
      return { ok: true };
    }
  } catch { /* on tente le repli */ }
  const ta = document.createElement("textarea");
  ta.value = texte;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const copie = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!copie) throw new Error("copie refusée par la webview");
  return { ok: true };
}
