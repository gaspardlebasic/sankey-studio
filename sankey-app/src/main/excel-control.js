"use strict";

/**
 * Pilotage d'Excel depuis l'application (enregistrer + fermer un classeur).
 *
 * Utilisé uniquement si l'utilisateur a coché « autoriser l'app à piloter Excel ».
 * macOS   : AppleScript (osascript) — demande l'autorisation « Automatisation »
 *           au premier appel (voir NSAppleEventsUsageDescription dans package.json).
 * Windows : COM via Windows PowerShell (GetActiveObject).
 * Ailleurs: non pris en charge.
 *
 * Renvoie toujours { ok, state, error? } avec state parmi :
 *   "closed"      le classeur a été enregistré puis fermé
 *   "not-running" Excel n'est pas lancé (donc rien à fermer)
 *   "not-open"    Excel tourne mais n'a pas ce classeur ouvert
 *   "save-failed" l'enregistrement a échoué : on ne ferme rien (aucune perte)
 *   "unsupported" plateforme non gérée
 *   "denied"      autorisation refusée par le système
 *   "timeout"     Excel n'a pas répondu (probable boîte de dialogue ouverte)
 *   "error"       autre échec
 */

const { execFile } = require("child_process");
const fs = require("fs");
const { isWorkbookLocked } = require("./excel");
const path = require("path");

const TIMEOUT_MS = 20000;

// Excel ne crée PAS de fichier verrou « ~$… » pour un classeur ouvert depuis
// OneDrive : il faut le lui demander directement.
const MAC_IS_OPEN = `
on run argv
  set targetName to item 2 of argv
  if application "Microsoft Excel" is not running then return "closed"
  tell application "Microsoft Excel"
    set noms to name of every workbook
  end tell
  repeat with n in noms
    if (n as text) is targetName then return "open"
  end repeat
  return "closed"
end run
`;

const WIN_IS_OPEN = `
$target = $env:SANKEY_XLSX
$leaf = Split-Path $target -Leaf
try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') }
catch { Write-Output 'closed'; exit 0 }
foreach ($wb in $xl.Workbooks) {
  if ($wb.FullName -eq $target -or $wb.Name -eq $leaf) { Write-Output 'open'; exit 0 }
}
Write-Output 'closed'
`;

const MAC_SCRIPT = `
on run argv
  set targetName to item 2 of argv
  if application "Microsoft Excel" is not running then return "not-running"
  tell application "Microsoft Excel"
    set noms to name of every workbook
    set idx to 0
    repeat with i from 1 to count of noms
      if ((item i of noms) as text) is targetName then set idx to i
    end repeat
    if idx is 0 then return "not-open"
    try
      save workbook idx
    on error
      return "save-failed"
    end try
    close workbook idx saving no
  end tell
  return "closed"
end run
`;

const WIN_SCRIPT = `
$ErrorActionPreference = 'Stop'
$target = $env:SANKEY_XLSX
$leaf = Split-Path $target -Leaf
try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') }
catch { Write-Output 'not-running'; exit 0 }
$targets = @()
foreach ($wb in $xl.Workbooks) {
  if ($wb.FullName -eq $target -or $wb.Name -eq $leaf) { $targets += $wb }
}
if ($targets.Count -eq 0) { Write-Output 'not-open'; exit 0 }
foreach ($wb in $targets) {
  try { $wb.Save() } catch { Write-Output 'save-failed'; exit 0 }
  $wb.Close($false)
}
Write-Output 'closed'
`;

function run(cmd, args, input, env) {
  return new Promise(resolve => {
    let child;
    try {
      child = execFile(
        cmd,
        args,
        { timeout: TIMEOUT_MS, env: Object.assign({}, process.env, env || {}) },
        (err, stdout, stderr) => {
          resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
        }
      );
    } catch (e) {
      resolve({ err: e, stdout: "", stderr: String(e.message || e) });
      return;
    }
    if (input != null && child.stdin) {
      child.stdin.on("error", () => { /* tuyau fermé : géré par le callback */ });
      child.stdin.end(input);
    }
  });
}

/** Enregistre puis ferme `filePath` dans Excel s'il y est ouvert. */
async function saveAndCloseInExcel(filePath) {
  if (process.platform === "darwin") {
    const { err, stdout, stderr } = await run(
      "osascript",
      ["-", filePath, path.basename(filePath)],
      MAC_SCRIPT
    );
    return interpret(err, stdout, stderr);
  }
  if (process.platform === "win32") {
    const { err, stdout, stderr } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "-"],
      WIN_SCRIPT,
      { SANKEY_XLSX: filePath }
    );
    return interpret(err, stdout, stderr);
  }
  return { ok: false, state: "unsupported" };
}

function interpret(err, stdout, stderr) {
  const out = stdout.trim();
  if (out === "closed" || out === "not-running" || out === "not-open") {
    return { ok: true, state: out };
  }
  // Excel n'a pas pu enregistrer : le classeur reste ouvert, rien n'est perdu.
  if (out === "save-failed") return { ok: false, state: "save-failed" };
  const msg = (stderr.trim() || String((err && err.message) || "")).trim();
  if (err && err.killed) return { ok: false, state: "timeout", error: msg };
  // -1743 / « Not authorized » : l'utilisateur a refusé l'automatisation
  if (/-1743|not authorized|autoris/i.test(msg)) return { ok: false, state: "denied", error: msg };
  return { ok: false, state: "error", error: msg || "Excel n'a pas répondu." };
}

/**
 * Le classeur est-il ouvert dans Excel en ce moment ?
 *
 * Renvoie { supported, open, state } :
 *   supported=false  -> impossible de savoir (plateforme non gérée, autorisation
 *                       refusée, Excel muet). L'appelant retombe alors sur la
 *                       détection par fichier verrou.
 * Le résultat est mis en cache brièvement : la vérification a lieu avant chaque
 * édition, et un évènement Apple coûte ~100 ms.
 */
const CACHE_MS = 1200;
let cache = { path: null, at: 0, res: null };

async function isOpenInExcel(filePath) {
  if (!filePath) return { supported: true, open: false, state: "closed" };
  const now = Date.now();
  if (cache.path === filePath && now - cache.at < CACHE_MS) return cache.res;

  let res;
  if (process.platform === "darwin") {
    const { err, stdout, stderr } = await run(
      "osascript", ["-", filePath, path.basename(filePath)], MAC_IS_OPEN
    );
    res = lireEtat(err, stdout, stderr);
  } else if (process.platform === "win32") {
    const { err, stdout, stderr } = await run(
      "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"],
      WIN_IS_OPEN, { SANKEY_XLSX: filePath }
    );
    res = lireEtat(err, stdout, stderr);
  } else {
    res = { supported: false, open: false, state: "unsupported" };
  }
  cache = { path: filePath, at: now, res };
  return res;
}

function lireEtat(err, stdout, stderr) {
  const out = String(stdout || "").trim();
  if (out === "open") return { supported: true, open: true, state: "open" };
  if (out === "closed") return { supported: true, open: false, state: "closed" };
  const msg = (String(stderr || "").trim() || String((err && err.message) || "")).trim();
  const denied = /-1743|not authorized|autoris/i.test(msg);
  return { supported: false, open: false, state: denied ? "denied" : "error", error: msg };
}

/** Vide le cache (après une fermeture provoquée par l'app, par exemple). */
function forgetOpenState() {
  cache = { path: null, at: 0, res: null };
}

/**
 * Le classeur est-il actuellement ouvert dans Excel ?
 *
 * Deux signaux, car aucun ne suffit :
 *  - le fichier verrou « ~$… », qu'Excel crée pour un fichier local ;
 *  - la liste des classeurs ouverts, demandée à Excel — indispensable car Excel
 *    ne pose PAS de fichier verrou pour un classeur ouvert depuis OneDrive.
 * `mode` dit lequel a répondu, pour que l'app puisse signaler une détection
 * dégradée (autorisation d'automatisation refusée).
 */
async function workbookState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { locked: false, exists: false, mode: "absent" };
  if (isWorkbookLocked(filePath)) return { locked: true, exists: true, mode: "verrou" };
  const r = await isOpenInExcel(filePath);
  if (!r.supported) return { locked: false, exists: true, mode: r.state === "denied" ? "refuse" : "indetermine" };
  return { locked: r.open, exists: true, mode: "excel" };
}

module.exports = { saveAndCloseInExcel, isOpenInExcel, workbookState, forgetOpenState };
