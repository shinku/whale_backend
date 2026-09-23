import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

export interface IEduNewsReporterOptions {
  /** 输出通道，默认 console */
  log?: (message: string) => void;
  /** 单条日志里结果的截断长度 */
  maxLength?: number;
}

export const oneLine = (text: unknown, max = 240) => {
  const value = String(text === undefined || text === null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const toolNameOf = (tool: any, runName?: string) => {
  if (runName) {
    return runName;
  }
  if (typeof tool === 'string') {
    return tool;
  }
  if (tool?.name) {
    return tool.name;
  }
  if (Array.isArray(tool?.id) && tool.id.length) {
    return tool.id[tool.id.length - 1];
  }
  return 'unknown';
};

const contentOf = (message: any) => {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(block => (typeof block === 'string' ? block : block?.text || ''))
      .join(' ')
      .trim();
  }
  return '';
};

/** 工具返回值可能是字符串，也可能是 ToolMessage 之类的对象 */
const outputOf = (output: any) => {
  if (output === undefined || output === null) {
    return '';
  }
  if (typeof output === 'string') {
    return output;
  }
  if (typeof output?.content === 'string') {
    return output.content;
  }
  if (typeof output?.output === 'string') {
    return output.output;
  }
  try {
    return JSON.stringify(output);
  } catch (e) {
    return String(output);
  }
};

/**
 * 把 agent 的每一步打印到控制台：模型调用、工具调用、工具返回、失败原因。
 * 只做日志，不参与决策，任何异常都吞掉，不能影响采集。
 */
export class EduNewsAgentReporter extends BaseCallbackHandler {
  name = 'eduNewsAgentReporter';

  private step = 0;

  private stepOfRun = new Map<string, number>();

  private startedAt = new Map<string, number>();

  private log: (message: string) => void;

  private maxLength: number;

  constructor(options: IEduNewsReporterOptions = {}) {
    super();
    this.log = options.log || (message => console.log(message));
    this.maxLength = options.maxLength || 240;
  }

  private emit(build: () => string | string[]) {
    try {
      const result = build();
      const lines = Array.isArray(result) ? result : [result];
      lines.forEach(line => this.log(line));
    } catch (e) {
      // 日志失败不能影响采集
    }
  }

  private begin(runId: string) {
    const step = ++this.step;
    if (runId) {
      this.stepOfRun.set(runId, step);
      this.startedAt.set(runId, Date.now());
    }
    return step;
  }

  private finish(runId: string) {
    const step = this.stepOfRun.get(runId) || ++this.step;
    const startedAt = this.startedAt.get(runId);
    this.stepOfRun.delete(runId);
    this.startedAt.delete(runId);
    const cost = startedAt
      ? ` ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
      : '';
    return { step, cost };
  }

  handleChatModelStart(
    llm: any,
    _messages: any[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: any,
    _tags?: string[],
    _metadata?: any,
    runName?: string
  ) {
    this.onModelStart(runId, llm, runName);
  }

  // 非 chat 模型走这个回调，chat 模型优先走 handleChatModelStart
  handleLLMStart(
    llm: any,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: any,
    _tags?: string[],
    _metadata?: any,
    runName?: string
  ) {
    this.onModelStart(runId, llm, runName);
  }

  private onModelStart(runId: string, llm: any, runName?: string) {
    this.emit(() => {
      const step = this.begin(runId);
      const model = oneLine(
        runName ||
          llm?.name ||
          (Array.isArray(llm?.id) ? llm.id[llm.id.length - 1] : 'model'),
        40
      );
      return `[eduNews] ── step ${step} ── 🧠 调用模型 ${model}…`;
    });
  }

  handleLLMEnd(output: any, runId: string) {
    this.emit(() => {
      const { step, cost } = this.finish(runId);
      const generation = output?.generations?.[0]?.[0];
      const message = generation?.message || generation;
      const toolCalls = message?.tool_calls || [];
      const content = contentOf(message);
      const lines = [
        `[eduNews] ── step ${step} ── 🧠 模型返回（${cost.trim() || '0s'}）`,
      ];
      if (content) {
        lines.push(`[eduNews]    💬 说明：${oneLine(content, this.maxLength)}`);
      }
      if (toolCalls.length) {
        toolCalls.forEach((call: any) => {
          const args =
            typeof call?.args === 'string'
              ? call.args
              : JSON.stringify(call?.args || {});
          lines.push(
            `[eduNews]    🔧 决定调用：${call?.name}(${oneLine(
              args,
              this.maxLength
            )})`
          );
        });
      }
      if (!content && !toolCalls.length) {
        lines.push('[eduNews]    （空回复）');
      }
      return lines;
    });
  }

  handleToolStart(
    tool: any,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: any,
    runName?: string
  ) {
    this.emit(() => {
      const step = this.begin(runId);
      return `[eduNews] ── step ${step} ── ▶ 执行工具 ${toolNameOf(
        tool,
        runName
      )}(${oneLine(input, this.maxLength)})`;
    });
  }

  handleToolEnd(output: any, runId: string) {
    this.emit(() => {
      const { step, cost } = this.finish(runId);
      return `[eduNews] ── step ${step} ── ✅ 工具返回（${
        cost.trim() || '0s'
      }）：${oneLine(outputOf(output), this.maxLength)}`;
    });
  }

  handleToolError(err: any, runId: string) {
    this.emit(() => {
      const { step, cost } = this.finish(runId);
      return `[eduNews] ── step ${step} ── ❌ 工具失败（${
        cost.trim() || '0s'
      }）：${oneLine(err?.message || err)}`;
    });
  }

  handleLLMError(err: any, runId: string) {
    this.emit(() => {
      const { step } = this.finish(runId);
      return `[eduNews] ── step ${step} ── ❌ 模型调用失败：${oneLine(
        err?.message || err
      )}`;
    });
  }
}
