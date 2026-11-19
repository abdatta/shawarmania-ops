// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { startupScript } from './startup.ts'

const PLACES = {
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  packageDir: 'C:\\Users\\owner\\Code\\shawarmania-ops\\tools\\campaign-sender',
  dataFolder: 'C:\\Users\\owner\\AppData\\Local\\shawarmania-campaign-sender-business',
}

describe('the script that starts the sender with Windows', () => {
  const script = startupScript(PLACES)

  it('runs the sender with no window, from its package, on the folder it was installed from', () => {
    expect(script).toContain(`shell.CurrentDirectory = "${PLACES.packageDir}"`)
    expect(script).toContain(
      `shell.Environment("Process")("CAMPAIGN_SENDER_DATA_DIR") = "${PLACES.dataFolder}"`,
    )
    // Window style 0 is hidden; False is: do not wait for it.
    expect(script).toMatch(/shell\.Run ".*", 0, False\r\n$/)
  })

  it('quotes a path with spaces the way VBScript and cmd each need', () => {
    expect(script).toContain(
      'shell.Run "cmd /c """"C:\\Program Files\\nodejs\\node.exe"" --experimental-strip-types',
    )
    expect(script).toContain(
      'src\\main.ts start >> ""C:\\Users\\owner\\AppData\\Local\\shawarmania-campaign-sender-business\\sender.log"" 2>&1"""',
    )
  })

  it('uses Windows line endings, which the script host expects', () => {
    expect(script.split('\r\n').length).toBeGreaterThan(5)
    expect(script.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('refuses a path it could not quote safely', () => {
    expect(() => startupScript({ ...PLACES, dataFolder: 'C:\\odd"folder' })).toThrow()
  })
})
