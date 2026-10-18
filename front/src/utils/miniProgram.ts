export const detectMiniProgram = () =>
  new Promise<boolean>((resolve) => {
    if (
      typeof window === 'undefined' ||
      !window.wx?.miniProgram?.getEnv
    ) {
      resolve(false)
      return
    }

    window.wx.miniProgram.getEnv((res) => {
      resolve(Boolean(res.miniprogram))
    })
  })
