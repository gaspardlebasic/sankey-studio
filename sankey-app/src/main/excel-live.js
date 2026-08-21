"use strict";

/**
 * Écriture « à chaud » : au lieu de disputer le fichier à Excel, on demande à
 * Excel d'écrire.
 *
 * Quand le classeur est déjà ouvert dans Excel — cas normal d'un fichier
 * OneDrive/SharePoint, qu'Excel ouvre depuis son URL et non depuis la copie
 * locale — écrire le .xlsx sur le disque ne sert à rien : Excel garde sa
 * version en mémoire et l'écrase à la première sauvegarde. On pousse donc les
 * valeurs dans le classeur ouvert, comme on lui demande déjà d'enregistrer et
 * de fermer.
 *
 * macOS   : JXA (osascript -l JavaScript). Choisi plutôt qu'AppleScript pour
 *           l'UTF-8 et JSON natifs — les noms de nœuds sont accentués.
 * Windows : COM via PowerShell (GetActiveObject), même principe.
 *
 * Le coût n'est pas dans le nombre de cellules mais dans le nombre d'évènements
 * envoyés à Excel : on écrit chaque tableau en UN seul évènement (affectation
 * d'un tableau 2D à une plage), jamais cellule par cellule.
 *
 * Les colonnes sont désignées par leur EN-TÊTE, jamais par leur position : un
 * classeur écrit avant l'arrivée d'une colonne (« Couloir ») n'a pas la même
 * largeur de tableau qu'un classeur récent. Les en-têtes manquants sont ajoutés
 * au tableau, les colonnes inconnues sont recopiées telles quelles.
 *
 * Renvoie { ok, state, ... } avec state parmi :
 *   "written"     les valeurs sont dans le classeur ouvert
 *   "not-running" Excel n'est pas lancé
 *   "not-open"    Excel tourne mais n'a pas ce classeur
 *   "no-sheet"    le classeur n'a pas l'onglet géré
 *   "no-tables"   l'onglet n'a pas les deux tableaux attendus
 *   "no-column"   une colonne manque et la place à droite du tableau est prise
 *   "unsupported" plateforme non gérée
 *   "denied"      automatisation refusée par le système
 *   "timeout"     Excel n'a pas répondu (boîte de dialogue ? cellule en édition ?)
 *   "error"       autre échec
 * Tous les états autres que "written" veulent dire « rien n'a été touché » :
 * l'appelant retombe sur l'écriture classique du fichier .xlsx.
 */

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildModelRows, NODE_COLS, LINK_COLS } = require("./excel");

const TIMEOUT_MS = 30000;

/* ------------------------------------------------------------------ *
 * Script macOS (JXA). Reçoit le chemin d'un fichier JSON en argument,
 * répond un JSON sur la sortie standard.
 * ------------------------------------------------------------------ */
const MAC_JXA = [
  "ObjC.import('Foundation');",
  "function lire(p) {",
  "  var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);",
  "  return JSON.parse(ObjC.unwrap(s));",
  "}",
  "function colLetter(n) {",
  "  var s = '';",
  "  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }",
  "  return s;",
  "}",
  "function trouverTable(ws, entete) {",
  "  for (var i = 0; i < ws.listObjects.length; i++) {",
  "    var lo = ws.listObjects[i];",
  "    for (var c = 0; c < lo.listColumns.length; c++) {",
  "      if (lo.listColumns[c].name() === entete) return lo;",
  "    }",
  "  }",
  "  return null;",
  "}",
  "function geo(lo) {",
  "  var r = lo.rangeObject;",
  "  var e = [];",
  "  for (var c = 0; c < lo.listColumns.length; c++) e.push(lo.listColumns[c].name());",
  "  return { ligne: r.firstRowIndex(), col: r.firstColumnIndex(),",
  "           lignes: lo.listRows.length, cols: lo.listColumns.length, entetes: e };",
  "}",
  "function plage(ws, l1, l2, c1, c2) {",
  "  return ws.ranges[colLetter(c1) + l1 + ':' + colLetter(c2) + l2];",
  "}",
  // Ajuste le nombre de lignes de données d'un tableau à `cible`, en ne touchant
  // QUE ses colonnes — sinon le tableau voisin se décale avec.
  //
  // Croissance : insertion de lignes DANS le tableau. Écrire sous le tableau
  // l'étend aussi tout seul, mais bien plus lentement (mesuré : 1 500 ms contre
  // 260 ms, Excel reconstruisant le tableau entier à chaque auto-extension).
  // Un tableau Excel ne peut pas avoir zéro ligne : on en garde une, vide.
  "function ajuster(xl, ws, g, cible) {",
  "  var garde = Math.max(cible, 1);",
  "  if (garde === g.lignes) return garde;",
  "  var derniere = g.ligne + g.lignes;",
  "  var c2 = g.col + g.cols - 1;",
  "  if (garde > g.lignes) {",
  "    var k = garde - g.lignes;",
  "    xl.insertIntoRange(plage(ws, derniere, derniere + k - 1, g.col, c2), { shift: 'shift down' });",
  "    return garde;",
  "  }",
  "  xl.deleteRange(plage(ws, g.ligne + 1 + garde, derniere, g.col, c2), { shift: 'shift up' });",
  "  return garde;",
  "}",
  // Ajoute au tableau les en-têtes attendus qui lui manquent. Écrire un en-tête
  // dans la colonne qui suit le tableau l'y étend (auto-extension), à condition
  // que cette colonne soit libre — sinon on ne touche à rien.
  "function ajouterColonnes(ws, lo, attendus) {",
  "  var g = geo(lo);",
  "  var ajouts = 0;",
  "  for (var i = 0; i < attendus.length; i++) {",
  "    if (g.entetes.indexOf(attendus[i]) >= 0) continue;",
  "    var c = g.col + g.cols;",
  "    var voisine = ws.ranges[colLetter(c) + g.ligne].value();",
  "    if (voisine !== '' && voisine !== null && voisine !== undefined) return -1;",
  "    ws.ranges[colLetter(c) + g.ligne].value = attendus[i];",
  "    g = geo(lo);",
  "    ajouts++;",
  "  }",
  "  return ajouts;",
  "}",
  // Écrit le corps d'un tableau. `rows` est aligné sur `attendus` ; on le
  // réordonne selon les en-têtes réels du tableau, et l'on recopie inchangées
  // les colonnes que l'app ne connaît pas.
  "function ecrire(xl, ws, lo, attendus, rows, formules, nomFormule) {",
  "  var t0 = Date.now();",
  "  if (ajouterColonnes(ws, lo, attendus) < 0) return { erreur: 'no-column' };",
  "  var g = geo(lo);",
  "  var pos = g.entetes.map(function (h) { return attendus.indexOf(h); });",
  "  var inconnues = pos.some(function (k) { return k < 0; });",
  "  var existant = null;",
  "  if (inconnues && g.lignes > 0) {",
  "    existant = plage(ws, g.ligne + 1, g.ligne + g.lignes, g.col, g.col + g.cols - 1).value();",
  "  }",
  "  ajuster(xl, ws, g, rows.length);",
  "  g = geo(lo);",
  "  var n = Math.max(rows.length, 1);",
  "  var corps = [];",
  "  for (var i = 0; i < n; i++) {",
  "    var ligne = [];",
  "    for (var j = 0; j < g.cols; j++) {",
  "      var k = pos[j];",
  "      if (k >= 0) ligne.push(i < rows.length ? rows[i][k] : '');",
  "      else ligne.push(existant && existant[i] ? existant[i][j] : '');",
  "    }",
  "    corps.push(ligne);",
  "  }",
  "  plage(ws, g.ligne + 1, g.ligne + n, g.col, g.col + g.cols - 1).value = corps;",
  "  if (formules && nomFormule) {",
  "    var idx = g.entetes.indexOf(nomFormule);",
  "    if (idx >= 0) {",
  "      var c = g.col + idx;",
  "      plage(ws, g.ligne + 1, g.ligne + n, c, c).formula = formules;",
  "    }",
  "  }",
  "  return { lignes: rows.length, ms: Date.now() - t0 };",
  "}",
  "function run(argv) {",
  "  var p;",
  "  try { p = lire(argv[0]); } catch (e) { return JSON.stringify({ state: 'error', error: 'payload: ' + e }); }",
  "  try {",
  "    var xl = Application('Microsoft Excel');",
  "    if (!xl.running()) return JSON.stringify({ state: 'not-running' });",
  "    var wb = null;",
  "    for (var i = 0; i < xl.workbooks.length; i++) {",
  "      if (xl.workbooks[i].name() === p.workbook) { wb = xl.workbooks[i]; break; }",
  "    }",
  "    if (!wb) return JSON.stringify({ state: 'not-open' });",
  "    var ws = null;",
  "    for (var j = 0; j < wb.worksheets.length; j++) {",
  "      if (wb.worksheets[j].name() === p.sheet) { ws = wb.worksheets[j]; break; }",
  "    }",
  "    if (!ws) return JSON.stringify({ state: 'no-sheet' });",
  "    var loN = trouverTable(ws, p.nodeKey);",
  "    var loL = trouverTable(ws, p.linkKey);",
  "    if (!loN || !loL) return JSON.stringify({ state: 'no-tables' });",
  // Relit les formules de la colonne des valeurs AVANT d'écrire, pour ne pas
  // remplacer un calcul de l'utilisatrice par sa valeur figée.
  "    var gL = geo(loL);",
  "    var iVal = p.linkHeaders.indexOf(p.valueHeader);",
  "    var iSrc = p.linkHeaders.indexOf(p.srcIdHeader);",
  "    var iDst = p.linkHeaders.indexOf(p.dstIdHeader);",
  "    var iSN = p.linkHeaders.indexOf(p.srcNameHeader);",
  "    var iDN = p.linkHeaders.indexOf(p.dstNameHeader);",
  "    var conservees = {};",
  "    if (p.preserveFormulas && gL.lignes > 0) {",
  "      var jVal = gL.entetes.indexOf(p.valueHeader);",
  "      var jSrc = gL.entetes.indexOf(p.srcIdHeader);",
  "      var jDst = gL.entetes.indexOf(p.dstIdHeader);",
  "      var jSN = gL.entetes.indexOf(p.srcNameHeader);",
  "      var jDN = gL.entetes.indexOf(p.dstNameHeader);",
  "      if (jVal >= 0) {",
  "        var f = plage(ws, gL.ligne + 1, gL.ligne + gL.lignes, gL.col, gL.col + gL.cols - 1).formula();",
  "        for (var k = 0; k < f.length; k++) {",
  "          var cell = String(f[k][jVal] === undefined ? '' : f[k][jVal]);",
  "          if (cell.charAt(0) !== '=') continue;",
  "          if (jSrc >= 0 && jDst >= 0) conservees['id:' + f[k][jSrc] + ' ' + f[k][jDst]] = cell;",
  "          if (jSN >= 0 && jDN >= 0) conservees['nom:' + f[k][jSN] + ' ' + f[k][jDN]] = cell;",
  "        }",
  "      }",
  "    }",
  "    var colFormules = null;",
  "    var nbFormules = 0;",
  "    if (p.preserveFormulas && iVal >= 0) {",
  "      colFormules = p.links.map(function (r) {",
  "        var fx = null;",
  "        if (iSrc >= 0 && iDst >= 0) fx = conservees['id:' + r[iSrc] + ' ' + r[iDst]];",
  "        if (!fx && iSN >= 0 && iDN >= 0) fx = conservees['nom:' + r[iSN] + ' ' + r[iDN]];",
  "        if (fx) { nbFormules++; return [fx]; }",
  "        return [r[iVal]];",
  "      });",
  "      if (!nbFormules) colFormules = null;",
  "    }",
  "    var t0 = Date.now();",
  "    var rn = ecrire(xl, ws, loN, p.nodeHeaders, p.nodes, null, null);",
  "    if (rn.erreur) return JSON.stringify({ state: rn.erreur, table: 'noeuds' });",
  "    var rl = ecrire(xl, ws, loL, p.linkHeaders, p.links, colFormules, p.valueHeader);",
  "    if (rl.erreur) return JSON.stringify({ state: rl.erreur, table: 'liens' });",
  "    var sauve = null;",
  "    if (p.save) { try { wb.save(); sauve = true; } catch (e2) { sauve = false; } }",
  "    return JSON.stringify({ state: 'written', noeuds: rn, liens: rl,",
  "      formules: nbFormules, save: sauve, ms: Date.now() - t0 });",
  "  } catch (e) {",
  "    return JSON.stringify({ state: 'error', error: String(e) });",
  "  }",
  "}"
].join("\n");

/* ------------------------------------------------------------------ *
 * Script Windows (COM via PowerShell). Même déroulé.
 * NON TESTÉ : aucune machine Windows ici. La différence notable avec macOS
 * est que COM expose ListObject.Resize, plus direct que l'auto-extension.
 * ------------------------------------------------------------------ */
const WIN_PS = `
# ASCII uniquement : ce script transite par stdin, dont PowerShell 5.1 decode
# les octets avec la page de code de la console, pas en UTF-8.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$p = Get-Content -Raw -Encoding UTF8 $env:SANKEY_PAYLOAD | ConvertFrom-Json
function Out-State($o) { $o | ConvertTo-Json -Compress -Depth 5; exit 0 }
try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') }
catch { Out-State @{ state = 'not-running' } }
$wb = $null
foreach ($w in $xl.Workbooks) { if ($w.Name -eq $p.workbook) { $wb = $w; break } }
if ($null -eq $wb) { Out-State @{ state = 'not-open' } }
$ws = $null
foreach ($s in $wb.Worksheets) { if ($s.Name -eq $p.sheet) { $ws = $s; break } }
if ($null -eq $ws) { Out-State @{ state = 'no-sheet' } }

function Find-Table($ws, $entete) {
  foreach ($lo in $ws.ListObjects) {
    foreach ($c in $lo.ListColumns) { if ($c.Name -eq $entete) { return $lo } }
  }
  return $null
}
function Get-Headers($lo) {
  $h = @(); foreach ($c in $lo.ListColumns) { $h += $c.Name }
  return ,$h
}
# La virgule de tete empeche PowerShell de deplier le tableau 2D au retour.
function To-Grid($rows, $cols) {
  $a = New-Object 'object[,]' $rows.Count, $cols
  for ($i = 0; $i -lt $rows.Count; $i++) {
    for ($j = 0; $j -lt $cols; $j++) { $a[$i, $j] = $rows[$i][$j] }
  }
  return ,$a
}
# Ajoute les en-tetes manquants a droite du tableau (auto-extension), si la
# colonne voisine est libre. Renvoie -1 si elle ne l'est pas.
function Add-Columns($ws, $lo, $attendus) {
  $ajouts = 0
  foreach ($h in $attendus) {
    if ((Get-Headers $lo) -contains $h) { continue }
    $r0 = $lo.Range.Row
    $c = $lo.Range.Column + $lo.ListColumns.Count
    $v = $ws.Cells($r0, $c).Value2
    if ($null -ne $v -and "$v" -ne '') { return -1 }
    $ws.Cells($r0, $c).Value2 = $h
    $lo.Resize($ws.Range($ws.Cells($r0, $lo.Range.Column),
                         $ws.Cells($r0 + [Math]::Max($lo.ListRows.Count, 1), $c))) | Out-Null
    $ajouts++
  }
  return $ajouts
}
function Write-Table($ws, $lo, $attendus, $rows, $formules, $nomFormule) {
  if ((Add-Columns $ws $lo $attendus) -lt 0) { return 'no-column' }
  $entetes = Get-Headers $lo
  $r0 = $lo.Range.Row
  $c0 = $lo.Range.Column
  $nc = $lo.ListColumns.Count
  $avant = $lo.ListRows.Count
  $pos = @(); foreach ($h in $entetes) { $pos += [array]::IndexOf($attendus, $h) }
  $existant = $null
  if (($pos -contains -1) -and $avant -gt 0) { $existant = $lo.DataBodyRange.Value2 }
  $n = [Math]::Max($rows.Count, 1)
  # Resize attend la plage complete, en-tete incluse.
  $lo.Resize($ws.Range($ws.Cells($r0, $c0), $ws.Cells($r0 + $n, $c0 + $nc - 1))) | Out-Null
  # Resize ne vide PAS les cellules sorties du tableau : elles resteraient
  # affichees sous celui-ci. On les efface nous-memes.
  if ($avant -gt $n) {
    $ws.Range($ws.Cells($r0 + $n + 1, $c0), $ws.Cells($r0 + $avant, $c0 + $nc - 1)).ClearContents() | Out-Null
  }
  $corps = @()
  for ($i = 0; $i -lt $n; $i++) {
    $ligne = @()
    for ($j = 0; $j -lt $nc; $j++) {
      $k = $pos[$j]
      if ($k -ge 0) { if ($i -lt $rows.Count) { $ligne += $rows[$i][$k] } else { $ligne += '' } }
      elseif ($null -ne $existant -and $i -lt $avant) { $ligne += $existant[$i + 1, $j + 1] }
      else { $ligne += '' }
    }
    $corps += ,$ligne
  }
  $ws.Range($ws.Cells($r0 + 1, $c0), $ws.Cells($r0 + $n, $c0 + $nc - 1)).Value2 = To-Grid $corps $nc
  if ($null -ne $formules -and $nomFormule) {
    $idx = [array]::IndexOf($entetes, $nomFormule)
    if ($idx -ge 0) {
      $c = $c0 + $idx
      $ws.Range($ws.Cells($r0 + 1, $c), $ws.Cells($r0 + $n, $c)).Formula = To-Grid $formules 1
    }
  }
  return 'ok'
}

$loN = Find-Table $ws $p.nodeKey
$loL = Find-Table $ws $p.linkKey
if ($null -eq $loN -or $null -eq $loL) { Out-State @{ state = 'no-tables' } }

$iVal = [array]::IndexOf($p.linkHeaders, $p.valueHeader)
$iSrc = [array]::IndexOf($p.linkHeaders, $p.srcIdHeader)
$iDst = [array]::IndexOf($p.linkHeaders, $p.dstIdHeader)
$iSN  = [array]::IndexOf($p.linkHeaders, $p.srcNameHeader)
$iDN  = [array]::IndexOf($p.linkHeaders, $p.dstNameHeader)

# Formules de la colonne des valeurs, relues AVANT d'ecrire : on ne remplace
# pas un calcul de l'utilisatrice par sa valeur figee.
$conservees = @{}
$entetesL = Get-Headers $loL
if ($p.preserveFormulas -and $loL.ListRows.Count -gt 0) {
  $jVal = [array]::IndexOf($entetesL, $p.valueHeader)
  $jSrc = [array]::IndexOf($entetesL, $p.srcIdHeader)
  $jDst = [array]::IndexOf($entetesL, $p.dstIdHeader)
  $jSN  = [array]::IndexOf($entetesL, $p.srcNameHeader)
  $jDN  = [array]::IndexOf($entetesL, $p.dstNameHeader)
  if ($jVal -ge 0) {
    $f = $loL.DataBodyRange.Formula
    for ($i = 1; $i -le $loL.ListRows.Count; $i++) {
      $cell = [string]$f[$i, $jVal + 1]
      if (-not $cell.StartsWith('=')) { continue }
      if ($jSrc -ge 0 -and $jDst -ge 0) { $conservees['id:' + $f[$i, $jSrc + 1] + ' ' + $f[$i, $jDst + 1]] = $cell }
      if ($jSN -ge 0 -and $jDN -ge 0) { $conservees['nom:' + $f[$i, $jSN + 1] + ' ' + $f[$i, $jDN + 1]] = $cell }
    }
  }
}
$colFormules = $null
$nbFormules = 0
if ($p.preserveFormulas -and $iVal -ge 0 -and $conservees.Count -gt 0) {
  $colFormules = @()
  foreach ($r in $p.links) {
    $fx = $null
    if ($iSrc -ge 0 -and $iDst -ge 0) { $fx = $conservees['id:' + $r[$iSrc] + ' ' + $r[$iDst]] }
    if ($null -eq $fx -and $iSN -ge 0 -and $iDN -ge 0) { $fx = $conservees['nom:' + $r[$iSN] + ' ' + $r[$iDN]] }
    if ($null -ne $fx) { $nbFormules++; $colFormules += ,@($fx) } else { $colFormules += ,@($r[$iVal]) }
  }
  if ($nbFormules -eq 0) { $colFormules = $null }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$e1 = Write-Table $ws $loN $p.nodeHeaders $p.nodes $null $null
if ($e1 -ne 'ok') { Out-State @{ state = $e1; table = 'noeuds' } }
$e2 = Write-Table $ws $loL $p.linkHeaders $p.links $colFormules $p.valueHeader
if ($e2 -ne 'ok') { Out-State @{ state = $e2; table = 'liens' } }
$sauve = $null
if ($p.save) { try { $wb.Save(); $sauve = $true } catch { $sauve = $false } }
Out-State @{ state = 'written'; ms = $sw.ElapsedMilliseconds; save = $sauve; formules = $nbFormules;
             noeuds = @{ lignes = $p.nodes.Count; ms = $sw.ElapsedMilliseconds };
             liens = @{ lignes = $p.links.Count; ms = 0 } }
`;

/* ------------------------------------------------------------------ *
 * Lecture « à chaud ». Symétrique de l'écriture : quand Excel tient le
 * classeur, le .xlsx sur le disque peut être en retard sur ce que
 * l'utilisatrice voit à l'écran. On lit alors directement dans Excel.
 * ------------------------------------------------------------------ */
const MAC_JXA_READ = [
  "ObjC.import('Foundation');",
  "function lire(p) {",
  "  var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);",
  "  return JSON.parse(ObjC.unwrap(s));",
  "}",
  "function colLetter(n) {",
  "  var s = '';",
  "  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }",
  "  return s;",
  "}",
  "function trouverTable(ws, entete) {",
  "  for (var i = 0; i < ws.listObjects.length; i++) {",
  "    var lo = ws.listObjects[i];",
  "    for (var c = 0; c < lo.listColumns.length; c++) {",
  "      if (lo.listColumns[c].name() === entete) return lo;",
  "    }",
  "  }",
  "  return null;",
  "}",
  "function corps(ws, lo) {",
  "  var r = lo.rangeObject;",
  "  var l0 = r.firstRowIndex(), c0 = r.firstColumnIndex();",
  "  var nl = lo.listRows.length, nc = lo.listColumns.length;",
  "  var entetes = [];",
  "  for (var c = 0; c < nc; c++) entetes.push(lo.listColumns[c].name());",
  "  if (nl === 0) return { entetes: entetes, lignes: [] };",
  "  var adr = colLetter(c0) + (l0 + 1) + ':' + colLetter(c0 + nc - 1) + (l0 + nl);",
  "  return { entetes: entetes, lignes: ws.ranges[adr].value() };",
  "}",
  "function run(argv) {",
  "  var p = lire(argv[0]);",
  "  try {",
  "    var xl = Application('Microsoft Excel');",
  "    if (!xl.running()) return JSON.stringify({ state: 'not-running' });",
  "    var wb = null;",
  "    for (var i = 0; i < xl.workbooks.length; i++) {",
  "      if (xl.workbooks[i].name() === p.workbook) { wb = xl.workbooks[i]; break; }",
  "    }",
  "    if (!wb) return JSON.stringify({ state: 'not-open' });",
  "    var ws = null;",
  "    for (var j = 0; j < wb.worksheets.length; j++) {",
  "      if (wb.worksheets[j].name() === p.sheet) { ws = wb.worksheets[j]; break; }",
  "    }",
  "    if (!ws) return JSON.stringify({ state: 'no-sheet' });",
  "    var loN = trouverTable(ws, p.nodeKey);",
  "    var loL = trouverTable(ws, p.linkKey);",
  "    if (!loN || !loL) return JSON.stringify({ state: 'no-tables' });",
  "    return JSON.stringify({ state: 'read', enregistre: wb.saved(),",
  "      noeuds: corps(ws, loN), liens: corps(ws, loL) });",
  "  } catch (e) {",
  "    return JSON.stringify({ state: 'error', error: String(e) });",
  "  }",
  "}"
].join("\n");

const WIN_PS_READ = `
# ASCII uniquement (voir WIN_PS).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$p = Get-Content -Raw -Encoding UTF8 $env:SANKEY_PAYLOAD | ConvertFrom-Json
function Out-State($o) { $o | ConvertTo-Json -Compress -Depth 6; exit 0 }
try { $xl = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') }
catch { Out-State @{ state = 'not-running' } }
$wb = $null
foreach ($w in $xl.Workbooks) { if ($w.Name -eq $p.workbook) { $wb = $w; break } }
if ($null -eq $wb) { Out-State @{ state = 'not-open' } }
$ws = $null
foreach ($s in $wb.Worksheets) { if ($s.Name -eq $p.sheet) { $ws = $s; break } }
if ($null -eq $ws) { Out-State @{ state = 'no-sheet' } }
function Find-Table($ws, $entete) {
  foreach ($lo in $ws.ListObjects) {
    foreach ($c in $lo.ListColumns) { if ($c.Name -eq $entete) { return $lo } }
  }
  return $null
}
function Read-Table($lo) {
  $entetes = @(); foreach ($c in $lo.ListColumns) { $entetes += $c.Name }
  $lignes = @()
  if ($lo.ListRows.Count -gt 0) {
    $v = $lo.DataBodyRange.Value2
    for ($i = 1; $i -le $lo.ListRows.Count; $i++) {
      $ligne = @()
      for ($j = 1; $j -le $entetes.Count; $j++) { $ligne += $v[$i, $j] }
      $lignes += ,$ligne
    }
  }
  return @{ entetes = $entetes; lignes = $lignes }
}
$loN = Find-Table $ws $p.nodeKey
$loL = Find-Table $ws $p.linkKey
if ($null -eq $loN -or $null -eq $loL) { Out-State @{ state = 'no-tables' } }
Out-State @{ state = 'read'; enregistre = $wb.Saved; noeuds = (Read-Table $loN); liens = (Read-Table $loL) }
`;

function run(cmd, args, input, env) {
  return new Promise(resolve => {
    let child;
    try {
      child = execFile(
        cmd,
        args,
        { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, env || {}) },
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

/** Traduit les lignes de `buildModelRows` en valeurs brutes pour Excel. */
function valeurs(rows) {
  return rows.map(r => r.map(c => (c.t === "n" ? Number(c.v) : c.t === "f" ? "=" + c.f : c.v)));
}

function construirePayload(filePath, model, sheetName, options) {
  const { nodeRows, linkRows } = buildModelRows(model, null);
  return {
    workbook: path.basename(filePath),
    sheet: sheetName || "Diagramme",
    nodeKey: "Noeud",
    linkKey: "Origine",
    nodeHeaders: NODE_COLS,
    linkHeaders: LINK_COLS,
    nodes: valeurs(nodeRows),
    links: valeurs(linkRows),
    valueHeader: "Valeur du flux",
    srcIdHeader: "ID origine",
    dstIdHeader: "ID destination",
    srcNameHeader: "Origine",
    dstNameHeader: "Destination",
    preserveFormulas: !(options && options.preserveFormulas === false),
    save: !!(options && options.save)
  };
}

function interpreter(err, stdout, stderr) {
  const brut = stdout.trim();
  let res = null;
  try {
    res = JSON.parse(brut.split("\n").pop());
  } catch (e) {
    res = null;
  }
  if (res && res.state) {
    return Object.assign({ ok: res.state === "written" }, res);
  }
  const msg = (stderr.trim() || String((err && err.message) || "") || brut).trim();
  if (err && err.killed) return { ok: false, state: "timeout", error: msg };
  if (/-1743|not authorized|autoris/i.test(msg)) return { ok: false, state: "denied", error: msg };
  return { ok: false, state: "error", error: msg || "Excel n'a pas répondu." };
}

/**
 * Pousse le modèle dans le classeur DÉJÀ OUVERT dans Excel.
 * options : { save: bool — demander à Excel d'enregistrer ensuite,
 *             preserveFormulas: bool (défaut vrai) }
 */
async function writeDiagramLive(filePath, model, sheetName, options) {
  if (!["darwin", "win32"].includes(process.platform)) {
    return { ok: false, state: "unsupported" };
  }
  const payload = construirePayload(filePath, model, sheetName, options);
  const tmp = path.join(os.tmpdir(), `sankey-live-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  try {
    if (process.platform === "darwin") {
      const { err, stdout, stderr } = await run(
        "osascript", ["-l", "JavaScript", "-", tmp], MAC_JXA
      );
      return interpreter(err, stdout, stderr);
    }
    const { err, stdout, stderr } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "-"],
      WIN_PS,
      { SANKEY_PAYLOAD: tmp }
    );
    return interpreter(err, stdout, stderr);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* fichier déjà parti */ }
  }
}

/** Lit les deux tableaux dans le classeur ouvert. Même contrat d'états. */
async function readTablesLive(filePath, sheetName) {
  if (!["darwin", "win32"].includes(process.platform)) {
    return { ok: false, state: "unsupported" };
  }
  const payload = {
    workbook: path.basename(filePath),
    sheet: sheetName || "Diagramme",
    nodeKey: "Noeud",
    linkKey: "Origine"
  };
  const tmp = path.join(os.tmpdir(), `sankey-read-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  try {
    let r;
    if (process.platform === "darwin") {
      const { err, stdout, stderr } = await run("osascript", ["-l", "JavaScript", "-", tmp], MAC_JXA_READ);
      r = interpreter(err, stdout, stderr);
    } else {
      const { err, stdout, stderr } = await run(
        "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"],
        WIN_PS_READ, { SANKEY_PAYLOAD: tmp }
      );
      r = interpreter(err, stdout, stderr);
    }
    return Object.assign({}, r, { ok: r.state === "read" });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* fichier déjà parti */ }
  }
}

/**
 * Convertit la lecture brute en { nodes, links }, même forme que readDiagram
 * de excel.js — pour que l'app n'ait pas deux modèles de données à gérer.
 */
function diagrammeDepuisTables(res, sheetName) {
  const idx = t => {
    const m = new Map();
    t.entetes.forEach((h, i) => m.set(String(h), i));
    return m;
  };
  const txt = v => (v === undefined || v === null ? "" : String(v)).trim();
  const nb = (v, d) => { const n = Number(v); return isNaN(n) ? d : n; };
  const val = (r, m, h) => (m.has(h) ? r[m.get(h)] : undefined);

  const cn = idx(res.noeuds);
  const nodes = [];
  for (const r of res.noeuds.lignes) {
    const name = txt(val(r, cn, "Noeud"));
    if (!name) continue;
    nodes.push({
      id: txt(val(r, cn, "ID")) || null,
      name,
      column: Math.round(nb(val(r, cn, "Numéro de colonne d'affichage"), 1)),
      title: txt(val(r, cn, "Intitulé de la colonne d'affichage")),
      order: Math.round(nb(val(r, cn, "Ordre vertical d'affichage"), 0)),
      lane: Math.max(1, Math.round(nb(val(r, cn, "Couloir"), 1))),
      filiere: txt(val(r, cn, "Filière")),
      color: txt(val(r, cn, "Couleur")) || null
    });
  }
  const cl = idx(res.liens);
  const links = [];
  for (const r of res.liens.lignes) {
    const s = txt(val(r, cl, "Origine"));
    const t = txt(val(r, cl, "Destination"));
    if (!s || !t) continue;
    links.push({
      sourceId: txt(val(r, cl, "ID origine")) || null,
      targetId: txt(val(r, cl, "ID destination")) || null,
      sourceName: s,
      targetName: t,
      value: nb(val(r, cl, "Valeur du flux"), 0),
      unit: txt(val(r, cl, "Unité"))
    });
  }
  return {
    sheetName: sheetName || "Diagramme", nodes, links,
    // Voir readDiagram : sans la colonne, on ne touche pas aux couloirs de l'app.
    hasLane: res.noeuds.entetes.map(String).includes("Couloir")
  };
}

/** Lecture à chaud, déjà mise à la forme { nodes, links }. */
async function readDiagramLive(filePath, sheetName) {
  const r = await readTablesLive(filePath, sheetName);
  if (!r.ok) return r;
  return { ok: true, state: "read", enregistre: r.enregistre,
           data: diagrammeDepuisTables(r, sheetName) };
}

module.exports = {
  writeDiagramLive, readDiagramLive, readTablesLive, diagrammeDepuisTables,
  construirePayload, MAC_JXA, WIN_PS, MAC_JXA_READ, WIN_PS_READ
};
