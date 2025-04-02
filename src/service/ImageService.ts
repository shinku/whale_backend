import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';

export const IMAGE_HANDLE_APIS = {
  /**
   * 擦除
   */
  handwritten_erase: 'https://api.textin.com/ai/service/v1/handwritten_erase',
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
}
