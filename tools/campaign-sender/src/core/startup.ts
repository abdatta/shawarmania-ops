/**
 * Starting the sender with Windows (design D7, task 4.6).
 *
 * D7 first said a Task Scheduler task at logon. A logon task usually needs an
 * administrator to create, and the owner's laptop is his everyday one; a file
 * in his own Startup folder needs nobody's permission, runs at his logon only,
 * and is removed by deleting it. So \`npm run install-startup\` writes one small
 * script there, and \`uninstall-startup\` deletes it.
 *
 * The script starts the **keeper** (\`keep-running.ts\`) with no window, in
 * the sender's package, pointed at the data folder it was installed from (the
 * business link's, in practice), with everything it and the sender print
 * appended to \`sender.log\` in that folder. The keeper runs the sender and
 * starts it again whenever it stops, until the owner asks it to stop or it
 * halts. The tray icon and the pinned card are its face.
 *
 * Text in, text out: nothing here touches the disk.
 */

/** The name the script has in the Startup folder. */
export const STARTUP_FILE = 'Shawarmania campaign sender.vbs'

export interface StartupPlaces {
  /** The \`node\` that runs the sender, as a full path. */
  nodePath: string
  /** \`tools/campaign-sender\`. */
  packageDir: string
  /** The data folder it sends from. */
  dataFolder: string
}

/** A VBScript string literal: quotes doubled, wrapped in quotes. */
function vbsString(text: string): string {
  return `"${text.replaceAll('"', '""')}"`
}

/** A quoted argument inside the command line the script runs. */
function quoted(text: string): string {
  return `"${text}"`
}

export function startupScript({ nodePath, packageDir, dataFolder }: StartupPlaces): string {
  for (const place of [nodePath, packageDir, dataFolder]) {
    if (place.includes('"') || /[\r\n]/.test(place)) {
      throw new Error('A path for the startup script cannot hold a quote or a line break.')
    }
  }
  const log = `${dataFolder.replace(/[\\/]+$/, '')}\\sender.log`
  const command = [
    'cmd /c',
    `"${quoted(nodePath)} --experimental-strip-types --no-warnings=ExperimentalWarning`,
    `src\\main.ts keep-running >> ${quoted(log)} 2>&1"`,
  ].join(' ')
  return [
    "' Keeps the Shawarmania campaign sender running from logon, with no window.",
    "' Written by npm run install-startup; npm run uninstall-startup deletes it.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = ${vbsString(packageDir)}`,
    `shell.Environment("Process")("CAMPAIGN_SENDER_DATA_DIR") = ${vbsString(dataFolder)}`,
    `shell.Run ${vbsString(command)}, 0, False`,
    '',
  ].join('\r\n')
}
