"use strict";

// macOS compose lui-même l'icône des documents : page blanche cornée, icône de
// l'app en médaillon, extension en capitales — à condition que le type de
// document n'impose PAS d'icône. electron-builder en pose toujours une (celle
// de l'app, qui donne une tuile noire pleine au lieu d'un document) ; on la
// retire après l'empaquetage pour laisser le système faire.
//
// Sans effet sur Windows, qui n'a pas d'équivalent : l'association y garde
// build/icon.ico (déclaré dans win.fileAssociations).

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function apresEmpaquetage(context) {
  if (context.electronPlatformName !== "darwin") return;

  const plist = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Info.plist"
  );

  let i = 0;
  // Une entrée par type déclaré : on s'arrête à la première absente.
  for (;;) {
    try {
      execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Delete :CFBundleDocumentTypes:${i}:CFBundleTypeIconFile`, plist],
        { stdio: "pipe" }
      );
    } catch (e) {
      // Clé absente : soit ce type n'en avait pas, soit il n'y a plus de type.
      try {
        execFileSync(
          "/usr/libexec/PlistBuddy",
          ["-c", `Print :CFBundleDocumentTypes:${i}`, plist],
          { stdio: "pipe" }
        );
      } catch (fin) {
        break;
      }
    }
    i += 1;
  }
};
