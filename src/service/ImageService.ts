import { Config, Inject, Provide } from '@midwayjs/core';
import axios from 'axios';
import { base64ToBuffer } from '../controller/file';
import { OssService } from './OssService';

const TI_CODE_MAP = {
  '40101': 'x-ti-app-id 或 x-ti-secret-code 为空',
  '40102': 'x-ti-app-id 或 x-ti-secret-code 无效，验证失败',
  '40103': '客户端IP不在白名单',
  '40003': '余额不足，请充值后再使用',
  '40004': '参数错误，请查看技术文档，检查传参',
  '40007': '机器人不存在或未发布',
  '40008': '机器人未开通，请至市场开通后重试',
  '40301':
    "文件类型不支持，接口会返回实际检测到的文件类型，如'当前文件类型为.gif'",
  '40302': '上传文件大小不符，文件大小不超过 50M',
  '40303': '文件类型不支持',
  '40304': '图片尺寸不符，图像宽高须介于 20 和 10000（像素）之间',
  '40305': '识别文件未上传',
  '40400': '无效的请求链接，请检查链接是否正确',
  '30203': '基础服务故障，请稍后重试',
  '500': '服务器内部错误',
};
/**
 *
 * @param code
 * @returns
 */
export const getCodeMessage = (code: string) => {
  return  TI_CODE_MAP[code as keyof typeof TI_CODE_MAP] || '';
};

export const IMAGE_HANDLE_APIS = {
  /**
   * 擦除
   */
  handwritten_erase: 'https://api.textin.com/ai/service/v1/handwritten_erase',
  img_to_pdf: 'https://api.textin.com/ai/service/v1/file-convert/image-to-pdf',
  pdf_to_docx: 'https://api.textin.com/ai/service/v1/file-convert/pdf-to-word',
};

export const TEXTIN_USER_APIS = {
  /**
   * 账户余额
   */
  balance: 'https://api.textin.com/user/finance/balance',
  /**
   * 套餐余量，需通过 api_path 指定要查询的产品
   */
  package: 'https://api.textin.com/user/finance/package',
};

/**
 * 各功能对应的套餐查询 api_path
 * GET https://api.textin.com/user/finance/package?api_path=xxx
 */
export const TEXTIN_PACKAGE_API_PATHS = {
  /**
   * 自动擦除手写文字
   */
  handwritten_erase: 'https://api.textin.com/ai/service/v1/handwritten_erase',
  /**
   * 图片转Word
   */
  doc_restore: 'https://api.textin.com/robot/v1.0/api/doc_restore',
};

export interface TIAccountBalance {
  /**
   * 账户总余额
   */
  balance?: number;
  /**
   * 可用 T 币余额
   */
  available_balance?: number;
}

export interface TIPackageItem {
  /**
   * 套餐 id
   */
  id?: number;
  /**
   * 该套餐覆盖的服务
   */
  service_list?: string[];
  /**
   * 套餐总次数
   */
  total_count?: number;
  /**
   * 剩余次数
   */
  remain_count?: number;
  /**
   * 已用次数
   */
  use_count?: number;
  /**
   * 套餐生效/失效时间
   */
  start_time?: string;
  end_time?: string;
}

export interface TIPackageSummary {
  /**
   * 套餐总次数，多个套餐时累加
   */
  total_count: number;
  /**
   * 剩余次数，多个套餐时累加
   */
  remain_count: number;
  /**
   * 已用次数，多个套餐时累加
   */
  use_count: number;
  /**
   * 最晚的失效时间
   */
  end_time?: string;
  /**
   * 原始套餐列表
   */
  list: TIPackageItem[];
}

@Provide()
export class ImageService {
  @Config('textin')
  config!: {
    'x-ti-app-id': string;
    'x-ti-secret-code': string;
  };

  decorHeader(header = {}) {
    return {
      ...header,
      'x-ti-app-id': this.config['x-ti-app-id'],
      'x-ti-secret-code': this.config['x-ti-secret-code'],
    };
  }
  /**
   * 擦除手写图像
   */
  async eraserHandWriteImage(data: Buffer) {
    const result = await axios.post(
      IMAGE_HANDLE_APIS.handwritten_erase + '?doc_direction=4',
      data,
      {
        headers: this.decorHeader({
          'Content-Type': 'application/octet-stream',
        }),
        responseType: 'json',
      }
    );
    return result;
  }

  @Inject()
  ossService!: OssService;

  @Config('outputDir')
  outputDir!: string;

  async tiImageToPdf(files: string[]) {
    // 读取文件，并转换为base64
    const lists = await Promise.all(
      files.map(async file => {
        const buffer = await this.ossService.getFile(file, 'buffer');
        const base64Data = buffer.content.toString('base64');
        return {
          fileName: file,
          data: base64Data,
        };
      })
    );
    const result = await axios.post(
      IMAGE_HANDLE_APIS.img_to_pdf,
      {
        files: lists.map(item => item.data),
      },
      {
        headers: this.decorHeader({
          'Content-Type': 'application/json',
        }),
        responseType: 'json',
      }
    );
    if (result.data.code !== 200) {
      throw new Error(getCodeMessage(result.data.code) || '图片转PDF失败');
    }

    const stream = base64ToBuffer(result.data.result);
    return stream;
  }
  /**
   * 合合信息的pdf转doc接口
   * @param stream
   * @returns
   */
  async tiPdfToDocx(stream: Buffer | string) {
    if (!stream) {
      throw new Error('stream_is_required');
    }
    const result = await axios.post(IMAGE_HANDLE_APIS.pdf_to_docx, stream, {
      headers: this.decorHeader({
        'Content-Type':
          stream instanceof Buffer ? 'application/octet-stream' : 'text/plain',
      }),
      responseType: 'json',
    });
    if (result.data.code !== 200) {
      throw new Error(getCodeMessage(result.data.code) || 'PDF转Word失败');
    }
    return base64ToBuffer(result.data.result);
  }

  /**
   * 查询当前 token 所属账户的余额
   * GET https://api.textin.com/user/finance/balance
   */
  async getAccountBalance(): Promise<TIAccountBalance> {
    const result = await axios.get(TEXTIN_USER_APIS.balance, {
      headers: this.decorHeader(),
      responseType: 'json',
    });
    const body = result.data || {};
    if (body.code !== undefined && body.code !== 200) {
      throw new Error(
        getCodeMessage(String(body.code)) || body.message || '查询余额失败'
      );
    }
    return body.data || {};
  }

  /**
   * 查询某个产品（api_path）的套餐余量
   * GET https://api.textin.com/user/finance/package?api_path=xxx
   */
  async getPackageQuota(apiPath: string): Promise<TIPackageItem[]> {
    const result = await axios.get(TEXTIN_USER_APIS.package, {
      params: { api_path: apiPath },
      headers: this.decorHeader(),
      responseType: 'json',
    });
    const body = result.data || {};
    if (body.code !== undefined && body.code !== 200) {
      throw new Error(
        getCodeMessage(String(body.code)) || body.message || '查询套餐余量失败'
      );
    }
    const list = (body.data || {}).list;
    return Array.isArray(list) ? list : [];
  }

  /**
   * 汇总某个产品的套餐余量，多个套餐时按次数累加
   */
  async getPackageSummary(apiPath: string): Promise<TIPackageSummary> {
    const list = await this.getPackageQuota(apiPath);
    const sum = (field: keyof TIPackageItem) =>
      list.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    return {
      total_count: sum('total_count'),
      remain_count: sum('remain_count'),
      use_count: sum('use_count'),
      end_time: list
        .map(item => item.end_time)
        .filter(Boolean)
        .sort()
        .pop(),
      list,
    };
  }
}
