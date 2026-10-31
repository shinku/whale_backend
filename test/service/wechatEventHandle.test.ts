import { WechatMessagePushRecordModel } from '../../src/model/WechatMessagePushRecordModel';
import { WechatEventHandle } from '../../src/service/eventHandler/WechatEventHandle';

function createRecord() {
  return {
    update: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WechatEventHandle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records and handles xpay_goods_deliver_notify', async () => {
    const record = createRecord();
    jest
      .spyOn(WechatMessagePushRecordModel, 'create')
      .mockResolvedValue(record as any);
    const handler = new WechatEventHandle();
    const vipHook = jest
      .spyOn(handler as any, 'onVipPurchaseEvent')
      .mockResolvedValue(undefined);
    const message = {
      ToUserName: 'gh_original',
      FromUserName: 'wx_official_openid',
      CreateTime: 1714112445,
      MsgType: 'event',
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'user-openid',
      OutTradeNo: 'VP_ORDER_1',
      Env: 1,
      WeChatPayInfo: {
        MchOrderNo: 'MCH_ORDER_1',
        TransactionId: 'WX_TRANSACTION_1',
        PaidTime: 1714112440,
      },
      GoodsInfo: {
        ProductId: 'month',
        Quantity: 1,
        OrigPrice: 990,
        ActualPrice: 890,
        Attach: 'vip',
      },
    };

    await handler.handle(message);

    expect(WechatMessagePushRecordModel.create).toHaveBeenCalledWith({
      event_name: 'xpay_goods_deliver_notify',
      openid: 'user-openid',
      out_trade_no: 'VP_ORDER_1',
      env: 1,
      content: JSON.stringify(message, null, 2),
      status: 'RECEIVED',
    });
    expect(vipHook).toHaveBeenCalledWith({
      openid: 'user-openid',
      productId: 'month',
      quantity: 1,
      outTradeNo: 'VP_ORDER_1',
      env: 1,
      paidTime: 1714112440,
      originalPrice: 990,
      actualPrice: 890,
      attach: 'vip',
      mchOrderNo: 'MCH_ORDER_1',
      transactionId: 'WX_TRANSACTION_1',
    });
    expect(record.update).toHaveBeenCalledWith({
      status: 'PROCESSED',
      product_id: 'month',
      quantity: 1,
      error_message: null,
    });
  });

  it('records unsupported events as ignored', async () => {
    const record = createRecord();
    jest
      .spyOn(WechatMessagePushRecordModel, 'create')
      .mockResolvedValue(record as any);
    const handler = new WechatEventHandle();

    await handler.handle({
      FromUserName: 'openid-1',
      MsgType: 'event',
      Event: 'debug_demo',
    });

    expect(record.update).toHaveBeenCalledWith({ status: 'IGNORED' });
  });

  it('records failed xpay events and propagates the error', async () => {
    const record = createRecord();
    jest
      .spyOn(WechatMessagePushRecordModel, 'create')
      .mockResolvedValue(record as any);
    const handler = new WechatEventHandle();

    await expect(
      handler.handle({
        Event: 'xpay_goods_deliver_notify',
        OpenId: 'openid-1',
        OutTradeNo: 'VP_ORDER_1',
        Env: 1,
      })
    ).rejects.toThrow('消息推送缺少 GoodsInfo');

    expect(record.update).toHaveBeenCalledWith({
      status: 'FAILED',
      error_message: '消息推送缺少 GoodsInfo',
    });
  });
});
