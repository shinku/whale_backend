import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';

export const ERROR_COLLECT_API_URL =
  'https://questiontr.market.alicloudapi.com/sjtmjc';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export const ERROR_COLLECT_CODE_MESSAGE: Record<number, string> = {
  500: '题目检测服务处理失败，请更换清晰图片后重试',
  1000: '请求主体错误',
  1001: '请求参数错误',
  1002: 'Content-Type 错误',
  1003: '没有找到图片文件',
  1004: '图片大小错误，图片需小于 5MB',
  1005: '图片格式错误，仅支持 jpg、jpeg、png',
  1006: '无效的签名',
  1007: '请求体大小错误',
  1008: '无调用权限，请检查 AppCode 或商品开通状态',
  2000: '题目检测服务未知错误',
  2001: '题目检测服务超时',
  2003: '没有识别出题目内容',
  2004: '识别结果校验失败',
  3000: '题目检测远程服务错误',
  4000: '题目检测基础服务错误',
};

export interface ErrorCollectStructureItem {
  block_type: 'wrong_question' | 'question' | string;
  location: number[];
}

export interface ErrorCollectResponse {
  code: number;
  message: string;
  data: {
    elapsed_time?: number;
    model_elapsed_time?: number;
    height?: number;
    width?: number;
    structure_result: ErrorCollectStructureItem[];
  };
  requestId?: string;
}

interface ErrorCollectUpstreamResponse {
  code: number;
  message: string;
  data?:
    | ErrorCollectResponse['data']
    | {
        code: number;
        message: string;
        data?: ErrorCollectResponse['data'];
      };
  requestId?: string;
}

/**
 * 去掉 data URL 前缀并校验图片内容。
 * 接口要求图片为 jpg/jpeg/png 且小于 5MB。
 */
export function normalizeErrorCollectMediaId(mediaId: string) {
  if (typeof mediaId !== 'string' || !mediaId.trim()) {
    throw new Error('media_id is required');
  }

  const compact = mediaId
    .trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .replace(/\s/g, '');

  if (
    !compact ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    throw new Error('media_id is not valid base64');
  }

  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length === 0) {
    throw new Error('media_id is not valid base64');
  }
  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('media_id image size must be less than 5MB');
  }

  const isPng =
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error('media_id image format must be jpg, jpeg or png');
  }

  return compact;
}

@Provide()
export class ErrorCollectService {
  @Config('errorCollect')
  config!: {
    appKey?: string;
    appSecret?: string;
    appCode?: string;
  };

  async collect(mediaId: string): Promise<ErrorCollectResponse> {
    const normalizedMediaId = normalizeErrorCollectMediaId(mediaId);
    const appCode = this.config?.appCode;
    if (!appCode) {
      throw new Error('error_collect_app_code_not_configured');
    }

    try {
      const result = await axios.post<ErrorCollectUpstreamResponse>(
        ERROR_COLLECT_API_URL,
        { media_id: normalizedMediaId },
        {
          headers: {
            Authorization: `APPCODE ${appCode}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          responseType: 'json',
          timeout: 30000,
          maxBodyLength: 10 * 1024 * 1024,
          maxContentLength: 10 * 1024 * 1024,
        }
      );

      return this.normalizeResponse(result.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const body = error.response?.data as
          | Partial<ErrorCollectUpstreamResponse>
          | undefined;
        const inner = this.getInnerResponse(body);
        const code = Number(inner?.code ?? body?.code);
        if (Number.isFinite(code) && ERROR_COLLECT_CODE_MESSAGE[code]) {
          throw new Error(ERROR_COLLECT_CODE_MESSAGE[code]);
        }
        if (error.code === 'ECONNABORTED') {
          throw new Error('题目检测服务超时，请稍后重试');
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error('无调用权限，请检查 AppCode 或商品开通状态');
        }
        if (inner?.message || body?.message) {
          throw new Error(inner?.message || body?.message);
        }
      }
      throw error;
    }
  }

  private normalizeResponse(
    body: ErrorCollectUpstreamResponse
  ): ErrorCollectResponse {
    const inner = this.getInnerResponse(body);
    const code = Number(inner?.code ?? body?.code);
    if (code !== 0) {
      throw new Error(
        ERROR_COLLECT_CODE_MESSAGE[code] ||
          inner?.message ||
          body?.message ||
          '题目检测失败'
      );
    }
    const data = inner?.data || (body?.data as ErrorCollectResponse['data']);
    if (!data || !Array.isArray(data.structure_result)) {
      throw new Error('题目检测结果格式异常');
    }
    return {
      code,
      message: inner?.message || body?.message || 'success',
      data,
      requestId: body?.requestId,
    };
  }

  private getInnerResponse(body: Partial<ErrorCollectUpstreamResponse>) {
    const data = body?.data;
    if (data && typeof data === 'object' && 'code' in data) {
      return data as {
        code: number;
        message: string;
        data?: ErrorCollectResponse['data'];
      };
    }
    return null;
  }
}
