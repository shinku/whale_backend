import { Config, Provide } from '@midwayjs/core';
import axios, { AxiosResponse } from 'axios';
import * as crypto from 'crypto';
import { readFileSync } from 'fs';
import { BusinessError } from '../core/errors';

interface WxPayConfig {
  appId: string;
  mchId: string;
  mchSerialNo: string;
  privateKeyPath: string;
  apiV3Key: string;
  notifyUrl: string;
  refundNotifyUrl: string;
  platformCertPath: string;
  platformSerialNo: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
}

export interface WxPayNotification {
  eventType: string;
  resource: WxTransaction;
}

export interface WxTransaction {
  appid: string;
  mchid: string;
  out_trade_no: string;
  transaction_id?: string;
  trade_state: string;
  amount: {
    total: number;
    payer_total?: number;
    currency: string;
  };
  payer?: {
    openid?: string;
  };
  success_time?: string;
  trade_state_desc?: string;
  [key: string]: unknown;
}

export interface WxRefundResource {
  mchid: string;
  out_trade_no: string;
  transaction_id: string;
  out_refund_no: string;
  refund_id: string;
  refund_status: string;
  success_time?: string;
  amount: {
    total: number;
    refund: number;
    payer_total?: number;
    payer_refund?: number;
    currency: string;
  };
  [key: string]: unknown;
}

interface WxRefundResponse {
  refund_id?: string;
  out_refund_no?: string;
  transaction_id?: string;
  out_trade_no?: string;
  status?: string;
  success_time?: string;
}

interface WechatSignatureHeaders {
  timestamp: string;
  nonce: string;
  signature: string;
  serial: string;
}

@Provide()
export class WxPayService {
  @Config('wxPay')
  config!: WxPayConfig;

  async createJsapiOrder(params: {
    outTradeNo: string;
    description: string;
    amountCents: number;
    openid: string;
  }) {
    const result = await this.request<{ prepay_id?: string }>(
      'POST',
      '/v3/pay/transactions/jsapi',
      {
        appid: this.config.appId,
        mchid: this.config.mchId,
        description: params.description.slice(0, 127),
        out_trade_no: params.outTradeNo,
        notify_url: this.config.notifyUrl,
        amount: {
          total: params.amountCents,
          currency: 'CNY',
        },
        payer: {
          openid: params.openid,
        },
        attach: 'vip',
      }
    );
    if (!result.prepay_id) {
      throw new BusinessError(
        '微信下单未返回 prepay_id',
        502,
        'WX_NO_PREPAY_ID'
      );
    }
    return result.prepay_id;
  }

  buildMiniProgramPayParams(prepayId: string) {
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const packageValue = `prepay_id=${prepayId}`;
    const message = [
      this.config.appId,
      timeStamp,
      nonceStr,
      packageValue,
      '',
    ].join('\n');
    const paySign = this.signWithMerchantPrivateKey(message);
    return {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA' as const,
      paySign,
    };
  }

  async queryOrder(outTradeNo: string): Promise<WxTransaction> {
    return this.request<WxTransaction>(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
        outTradeNo
      )}?mchid=${encodeURIComponent(this.config.mchId)}`
    );
  }

  async closeOrder(outTradeNo: string) {
    await this.request(
      'POST',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
        outTradeNo
      )}/close`,
      {
        mchid: this.config.mchId,
      }
    );
  }

  async createRefund(params: {
    outTradeNo: string;
    transactionId: string;
    outRefundNo: string;
    reason: string;
    amountCents: number;
    totalCents: number;
  }): Promise<WxRefundResponse> {
    if (!this.config.refundNotifyUrl) {
      throw new BusinessError('微信退款回调未配置', 503);
    }
    return this.request<WxRefundResponse>(
      'POST',
      '/v3/refund/domestic/refunds',
      {
        out_trade_no: params.outTradeNo,
        transaction_id: params.transactionId,
        out_refund_no: params.outRefundNo,
        reason: params.reason.slice(0, 80),
        notify_url: this.config.refundNotifyUrl,
        amount: {
          refund: params.amountCents,
          total: params.totalCents,
          currency: 'CNY',
        },
      }
    );
  }

  async queryRefund(outRefundNo: string): Promise<WxRefundResponse> {
    return this.request<WxRefundResponse>(
      'GET',
      `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`
    );
  }

  parseAndVerifyNotification(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): WxPayNotification {
    const notification = this.parseEncryptedNotification(headers, rawBody, [
      'TRANSACTION.SUCCESS',
    ]);
    const transaction = notification.resource as WxTransaction;
    if (transaction.trade_state !== 'SUCCESS') {
      throw new BusinessError('微信支付交易状态不是 SUCCESS', 400);
    }
    return {
      eventType: notification.eventType,
      resource: transaction,
    };
  }

  parseAndVerifyRefundNotification(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): { eventType: string; resource: WxRefundResource } {
    const notification = this.parseEncryptedNotification(headers, rawBody, [
      'REFUND.SUCCESS',
      'REFUND.ABNORMAL',
      'REFUND.CLOSED',
      'REFUND.PROCESSING',
    ]);
    return {
      eventType: notification.eventType,
      resource: notification.resource as WxRefundResource,
    };
  }

  getMerchantIdentity() {
    if (!this.config?.appId || !this.config?.mchId) {
      throw new BusinessError('微信支付商户信息未配置', 503);
    }
    return {
      appId: this.config.appId,
      mchId: this.config.mchId,
    };
  }

  private parseEncryptedNotification(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    eventTypes: string[]
  ): { eventType: string; resource: Record<string, any> } {
    const signatureHeaders = this.getSignatureHeaders(headers);
    this.verifyWechatSignature(
      signatureHeaders,
      rawBody,
      '微信支付回调验签失败'
    );

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new BusinessError('微信支付回调格式错误', 400);
    }
    if (
      !eventTypes.includes(payload.event_type) ||
      payload.resource_type !== 'encrypt-resource' ||
      !payload.resource
    ) {
      throw new BusinessError('微信支付回调事件类型不支持', 400);
    }
    return {
      eventType: payload.event_type,
      resource: this.decryptResource(payload.resource),
    };
  }

  private decryptResource(resource: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  }): WxTransaction {
    if (
      resource.algorithm !== 'AEAD_AES_256_GCM' ||
      !resource.ciphertext ||
      !resource.nonce
    ) {
      throw new BusinessError('微信支付回调资源格式错误', 400);
    }
    const key = Buffer.from(this.config.apiV3Key, 'utf8');
    if (key.length !== 32) {
      throw new BusinessError('微信支付 API v3 密钥配置错误', 503);
    }
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    if (ciphertext.length <= 16) {
      throw new BusinessError('微信支付回调密文错误', 400);
    }
    try {
      const authTag = ciphertext.subarray(ciphertext.length - 16);
      const data = ciphertext.subarray(0, ciphertext.length - 16);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(resource.nonce, 'utf8')
      );
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
      const decoded = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(decoded);
    } catch {
      throw new BusinessError('微信支付回调解密失败', 400);
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    canonicalUrl: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    this.assertConfigured();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const bodyText = body ? JSON.stringify(body) : '';
    const message = [method, canonicalUrl, timestamp, nonce, bodyText, ''].join(
      '\n'
    );
    const signature = this.signWithMerchantPrivateKey(message);
    const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",` +
      `nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",` +
      `serial_no="${this.config.mchSerialNo}"`;

    let response: AxiosResponse<string>;
    try {
      response = await axios.request<string>({
        method,
        url: `${this.config.apiBaseUrl.replace(/\/+$/, '')}${canonicalUrl}`,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'whale-vip-pay/1.0',
        },
        data: bodyText || undefined,
        timeout: Math.max(1000, Number(this.config.requestTimeoutMs || 10000)),
        responseType: 'text',
        transformResponse: value => value,
        validateStatus: () => true,
      });
    } catch {
      console.warn('[wxPay] request network error', { method, canonicalUrl });
      throw new BusinessError('微信支付服务暂时不可用', 502);
    }

    const responseBody =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data || {});
    this.verifyWechatSignature(
      this.getSignatureHeaders(response.headers as Record<string, unknown>),
      responseBody,
      '微信支付响应验签失败'
    );
    if (response.status < 200 || response.status >= 300) {
      const errorCode = this.extractErrorCode(responseBody);
      console.warn('[wxPay] request rejected', {
        method,
        canonicalUrl,
        status: response.status,
        code: errorCode,
      });
      throw new BusinessError(
        this.toPublicErrorMessage(errorCode),
        502,
        errorCode
      );
    }

    if (!responseBody) {
      return {} as T;
    }
    try {
      return JSON.parse(responseBody);
    } catch {
      throw new BusinessError('微信支付响应格式错误', 502);
    }
  }

  private verifyWechatSignature(
    headers: WechatSignatureHeaders,
    body: string,
    message: string
  ) {
    this.assertConfigured();
    const timestamp = Number(headers.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 5 * 60
    ) {
      throw new BusinessError('微信支付回调时间戳已过期', 401);
    }

    const certificate = readFileSync(this.config.platformCertPath, 'utf8');
    const X509Certificate = (crypto as any).X509Certificate;
    if (!X509Certificate) {
      throw new BusinessError('当前 Node.js 版本不支持平台证书校验', 503);
    }
    const cert = new X509Certificate(certificate);
    const configuredSerial = (this.config.platformSerialNo || '')
      .replace(/:/g, '')
      .toUpperCase();
    const certificateSerial = String(cert.serialNumber)
      .replace(/:/g, '')
      .toUpperCase();
    if (headers.serial.toUpperCase() !== certificateSerial) {
      throw new BusinessError(message, 401);
    }
    if (configuredSerial && configuredSerial !== certificateSerial) {
      throw new BusinessError('微信支付平台证书序列号配置不一致', 503);
    }

    const signText = [headers.timestamp, headers.nonce, body, ''].join('\n');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signText);
    verifier.end();
    if (!verifier.verify(cert.publicKey, headers.signature, 'base64')) {
      throw new BusinessError(message, 401);
    }
  }

  private getSignatureHeaders(
    headers: Record<string, string | string[] | undefined | unknown>
  ): WechatSignatureHeaders {
    const read = (name: string) => {
      const lowerName = name.toLowerCase();
      const value =
        headers[name] ??
        headers[lowerName] ??
        headers[
          name
            .split('-')
            .map(
              part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
            )
            .join('-')
        ];
      if (Array.isArray(value)) {
        return String(value[0] || '');
      }
      return typeof value === 'string' ? value : '';
    };
    const result = {
      timestamp: read('wechatpay-timestamp'),
      nonce: read('wechatpay-nonce'),
      signature: read('wechatpay-signature'),
      serial: read('wechatpay-serial'),
    };
    if (
      !result.timestamp ||
      !result.nonce ||
      !result.signature ||
      !result.serial
    ) {
      throw new BusinessError('缺少微信支付签名请求头', 401);
    }
    return result;
  }

  private signWithMerchantPrivateKey(message: string) {
    const privateKey = readFileSync(this.config.privateKeyPath, 'utf8');
    return crypto
      .sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey)
      .toString('base64');
  }

  private assertConfigured() {
    if (
      !this.config?.appId ||
      !this.config?.mchId ||
      !this.config?.mchSerialNo ||
      !this.config?.privateKeyPath ||
      !this.config?.apiV3Key ||
      !this.config?.notifyUrl ||
      !this.config?.platformCertPath
    ) {
      throw new BusinessError('微信支付未配置，请联系管理员', 503);
    }
  }

  private extractErrorCode(body: string) {
    try {
      const data = JSON.parse(body);
      return String(data.code || 'WECHAT_PAY_ERROR').slice(0, 64);
    } catch {
      return 'WECHAT_PAY_ERROR';
    }
  }

  private toPublicErrorMessage(code: string) {
    if (code === 'ORDERPAID') {
      return '订单已支付，请刷新支付结果';
    }
    if (code === 'ORDER_CLOSED') {
      return '订单已关闭，请重新下单';
    }
    return '微信支付下单失败，请稍后重试';
  }
}
