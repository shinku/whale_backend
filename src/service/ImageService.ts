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
  return TI_CODE_MAP[code] || '';
};

export const IMAGE_HANDLE_APIS = {
  /**
   * 擦除
   */
  handwritten_erase: 'https://api.textin.com/ai/service/v1/handwritten_erase',
  img_to_pdf: 'https://api.textin.com/ai/service/v1/file-convert/image-to-pdf',
};

@Provide()
export class ImageService {
  @Config('textin')
  config: {
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
  ossService: OssService;

  @Config('outputDir')
  outputDir: string;

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
}
