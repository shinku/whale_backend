import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { PlaywrightService } from '../service/PlaywrightService';
import Api from './api/Api';

@Provide()
@Api('/screen')
export class ScreenController {
  @Inject()
  ctx!: Context;

  @Inject()
  playwrightService!: PlaywrightService;

  /**
   * 用一个 URL 截图：无头浏览器打开该地址，onload 之后返回完整 HTML 与截图的 base64
   *
   * 请求体：
   * {
   *  "url": "https://example.com",   // 必填，仅支持 http/https
   *  "fullPage": true,               // 可选，默认 true（整页截图）
   *  "width": 1440,                  // 可选，视口宽度
   *  "height": 900,                  // 可选，视口高度
   *  "waitUntil": "load",            // 可选，load / domcontentloaded / networkidle，默认 load
   *  "inlineImage": true,            // 可选，默认 true：图片内联成 base64
   *  "maxImageBytes": 5242880,       // 可选，单张图片上限
   *  "maxTotalImageBytes": 20971520 // 可选，图片内联总量上限
   * }
   *
   * 返回：{ "status": 200, "data": { "url", "html", "screenshot" } }
   */
  @Post('/capture')
  async capture() {
    const {
      url,
      fullPage,
      width = 415,
      height = 768,
      waitUntil,
      inlineImage,
      maxImageBytes,
      maxTotalImageBytes,
    } = this.ctx.request.body || {};
    if (!url) {
      throw new Error('url is required');
    }
    const data = await this.playwrightService.capturePage(url, {
      fullPage,
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      waitUntil,
      inlineImage:
        inlineImage === undefined ? undefined : inlineImage !== false,
      maxImageBytes: maxImageBytes ? Number(maxImageBytes) : undefined,
      maxTotalImageBytes: maxTotalImageBytes
        ? Number(maxTotalImageBytes)
        : undefined,
    });
    return { data };
  }
}
