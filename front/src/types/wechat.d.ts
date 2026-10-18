interface Window {
  wx?: {
    miniProgram?: {
      getEnv(callback: (res: { miniprogram?: boolean }) => void): void
    }
  }
}
