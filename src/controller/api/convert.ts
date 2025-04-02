import { Config, Inject, Post, Provide } from "@midwayjs/core";
import { Context } from "egg";
import Api from "./Api";

@Api('/convert')
@Provide()
export class Convert {
  @Inject()
  ctx: Context

  @Config("outputDir")
  outputDir: string;
  //清除手写图片
  @Post('/clear_hand_write')
  async clearHandWrite(){
    //const userId = this.ctx.userId;
    //const image = this.ctx.request.body;
    console.log(this.outputDir)
  }
}