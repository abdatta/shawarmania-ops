import { createContext, useContext } from 'react'

export type InstallMode = 'native' | 'ios' | null

export type InstallPromptContextValue = {
  mode: InstallMode
  requestNativeInstall: () => Promise<void>
}

export const InstallPromptContext = createContext<InstallPromptContextValue>({
  mode: null,
  requestNativeInstall: async () => undefined,
})

export function useInstallPrompt() {
  return useContext(InstallPromptContext)
}
