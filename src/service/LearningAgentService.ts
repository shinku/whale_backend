import { Config, Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { HumanMessage } from '@langchain/core/messages';
import { createHash, randomUUID } from 'crypto';
import {
  createDeepAgent,
  FilesystemBackend,
  FilesystemPermission,
} from 'deepagents';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { BusinessError } from '../core/errors';
import { AgentUserProfile } from './UserService';
import { DeepSeekService } from './DeepSeekService';
import { PromptService } from './PromptService';
import { QwenService } from './QwenService';
import {
  LearningAgentHistoryMessage,
  LearningAgentToolContext,
  LearningAgentToolsService,
} from './LearningAgentToolsService';

const DEFAULT_AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RECURSION_LIMIT = 40;
const MAX_HISTORY_MESSAGES = 20;
const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;

export const LEARNING_AGENT_FILESYSTEM_PERMISSIONS: FilesystemPermission[] = [
  {
    operations: ['read', 'write'],
    paths: [
      '/etc/**',
      '/proc/**',
      '/sys/**',
      '/dev/**',
      '/root/**',
      '/var/**',
      '/System/**',
      '/Library/**',
      '/Applications/**',
      '/Users/**',
      '/private/**',
      '/bin/**',
      '/sbin/**',
      '/usr/**',
    ],
    mode: 'deny',
  },
  {
    operations: ['read', 'write'],
    paths: ['/**'],
    mode: 'allow',
  },
];

export interface LearningAgentChatInput {
  message: string;
  imageBase64?: string;
  history?: LearningAgentHistoryMessage[];
}

export type LearningAgentSseEvent =
  | {
      type: 'session';
      requestId: string;
      userId: string;
      user: {
        userName: string | null;
        vipType: string;
        vipActive: boolean;
      };
      format: 'json';
    }
  | {
      type: 'execution';
      stage: 'start' | 'end' | 'error' | 'note';
      tool?: string;
      content: string;
      format: 'markdown';
      data?: unknown;
    }
  | {
      type: 'answer';
      content: string;
      format: 'markdown';
    }
  | {
      type: 'done';
      requestId: string;
      durationMs: number;
    }
  | {
      type: 'error';
      status: number;
      code?: string;
      message: string;
    };

export function encodeAgentSse(event: LearningAgentSseEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class LearningAgentService {
  @Config('appDir')
  appDir!: string;

  @Inject()
  qwenService!: QwenService;

  @Inject()
  toolsService!: LearningAgentToolsService;

  @Inject()
  deepSeekService!: DeepSeekService;

  @Inject()
  promptService!: PromptService;

  async *streamChat(
    input: LearningAgentChatInput,
    profile: AgentUserProfile,
    userOrinted = ''
  ): AsyncGenerator<string, void, void> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DEFAULT_AGENT_TIMEOUT_MS);

    yield encodeAgentSse({
      type: 'session',
      requestId,
      userId: profile.openid,
      user: {
        userName: profile.userName,
        vipType: profile.vip.type,
        vipActive: profile.vip.active,
      },
      format: 'json',
    });

    try {
      const agent = this.createAgent(
        profile,
        input.history || [],
        Boolean(input.imageBase64),
        userOrinted.trim()
      );
      const messages = this.buildMessages(input);
      const events: AsyncIterable<any> = (await agent.streamEvents(
        { messages } as any,
        {
          version: 'v2',
          recursionLimit: DEFAULT_RECURSION_LIMIT,
          signal: controller.signal,
          configurable: {
            thread_id: requestId,
            user_id: profile.openid,
          },
        } as any
      )) as any;

      const bufferedModelContent = new Map<string, string>();
      const emittedAnswerRuns = new Set<string>();
      let toolSeen = false;
      let answerContent = '';

      for await (const event of events) {
        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk;
          const content = this.messageContent(chunk);
          if (!content) {
            continue;
          }
          if (toolSeen) {
            emittedAnswerRuns.add(event.run_id);
            answerContent += content;
            yield encodeAgentSse({
              type: 'answer',
              content,
              format: 'markdown',
            });
          } else {
            bufferedModelContent.set(
              event.run_id,
              (bufferedModelContent.get(event.run_id) || '') + content
            );
          }
          continue;
        }

        if (event.event === 'on_chat_model_end') {
          const output = event.data?.output;
          const content =
            this.messageContent(output) ||
            bufferedModelContent.get(event.run_id) ||
            '';
          const toolCalls = this.toolCallsOf(output);
          if (!emittedAnswerRuns.has(event.run_id)) {
            if (toolCalls.length > 0) {
              if (content) {
                yield encodeAgentSse({
                  type: 'execution',
                  stage: 'note',
                  content,
                  format: 'markdown',
                });
              }
            } else if (content) {
              for (const chunk of this.splitMarkdown(content)) {
                answerContent += chunk;
                yield encodeAgentSse({
                  type: 'answer',
                  content: chunk,
                  format: 'markdown',
                });
              }
              emittedAnswerRuns.add(event.run_id);
            }
          }
          bufferedModelContent.delete(event.run_id);
          continue;
        }

        if (event.event === 'on_tool_start') {
          toolSeen = true;
          const inputSummary = this.safeJson(event.data?.input);
          yield encodeAgentSse({
            type: 'execution',
            stage: 'start',
            tool: event.name,
            content: `正在执行 **${event.name}**${
              inputSummary ? `\n\n\`\`\`json\n${inputSummary}\n\`\`\`` : ''
            }`,
            format: 'markdown',
          });
          continue;
        }

        if (event.event === 'on_tool_end') {
          const output = this.safeJson(event.data?.output);
          yield encodeAgentSse({
            type: 'execution',
            stage: 'end',
            tool: event.name,
            content: `**${event.name}** 执行完成${
              output ? `\n\n\`\`\`text\n${output}\n\`\`\`` : ''
            }`,
            format: 'markdown',
          });
          continue;
        }

        if (event.event === 'on_tool_error') {
          yield encodeAgentSse({
            type: 'execution',
            stage: 'error',
            tool: event.name,
            content: `**${event.name}** 执行失败：${
              event.data?.error || '未知错误'
            }`,
            format: 'markdown',
          });
          continue;
        }

        if (
          event.event === 'on_chain_end' &&
          event.name === 'whale-learning-agent' &&
          !answerContent
        ) {
          const finalContent = this.finalMessageContent(event.data?.output);
          if (finalContent) {
            for (const chunk of this.splitMarkdown(finalContent)) {
              answerContent += chunk;
              yield encodeAgentSse({
                type: 'answer',
                content: chunk,
                format: 'markdown',
              });
            }
          }
        }
      }

      yield encodeAgentSse({
        type: 'done',
        requestId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error: unknown) {
      const status = timedOut
        ? 504
        : Number((error as any)?.status || (error as any)?.statusCode) || 500;
      const code = timedOut
        ? 'AGENT_TIMEOUT'
        : (error as any)?.code || 'AGENT_EXECUTION_FAILED';
      const message = timedOut
        ? '学习助手响应超时，请稍后重试'
        : error instanceof Error
        ? error.message
        : '学习助手执行失败';
      console.error('[learningAgent] stream failed', {
        requestId,
        status,
        code,
        message,
      });
      yield encodeAgentSse({
        type: 'error',
        status,
        code,
        message,
      });
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  buildSystemPrompt(profile: AgentUserProfile, userOrinted?: string) {
    const userContext = {
      userId: profile.openid,
      userName: profile.userName,
      mobile: profile.mobile,
      lane: profile.lane,
      registered: profile.registered,
      vipType: profile.vip.type,
      vipActive: profile.vip.active,
      vipAvailableEnd: profile.vip.availableEnd?.toISOString() || null,
    };

    return this.promptService
      .getPromptSync('aichat/chat')
      .replace('{{USER_CONTEXT}}', JSON.stringify(userContext, null, 2))
      .replace(
        '{{USER_ORINTED}}',
        userOrinted?.trim() || '暂无，请根据历史或当前消息总结。'
      );
  }

  async prepareUserOrinted(input: LearningAgentChatInput, existing?: string) {
    const current = String(existing || '')
      .trim()
      .slice(0, 500);

    const userHistory = (input.history || [])
      .filter(item => item.role === 'user')
      .slice(-6)
      .map(item => item.content.slice(0, 1000));
    const prompt = [
      `已保存的 user_orinted：${current || '无'}`,
      `最近用户消息：${
        userHistory.length ? userHistory.join('\n---\n') : '无'
      }`,
      `当前用户消息：${input.message}`,
      '如果当前消息明确开始了新的学习任务，请生成新的摘要；如果没有明确变化，必须原样返回已保存的 user_orinted。',
      '只返回一句简洁英文，不超过 200 个字符，不要 Markdown、解释或前缀。',
    ].join('\n\n');
    try {
      const summary = await this.deepSeekService.chatWithDeepSeek(
        prompt,
        'You summarize the user current learning task in English only. Return one concise English sentence. If no clear task change is stated, return the saved user_orinted unchanged. No Markdown or explanation.'
      );
      const normalized = String(summary || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      if (normalized && !/[\u3400-\u9fff]/.test(normalized)) {
        return normalized;
      }
    } catch (error) {
      console.warn('[learningAgent] userOrinted summary failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (current) {
      return current;
    }
    const fallback = userHistory[userHistory.length - 1] || input.message;
    return `The user is currently studying: ${fallback
      .replace(/[\u3400-\u9fff]+/g, 'K-12 learning content')
      .replace(/\s+/g, ' ')
      .slice(0, 180)}`;
  }

  private createAgent(
    profile: AgentUserProfile,
    history: LearningAgentHistoryMessage[],
    hasImage: boolean,
    userOrinted: string
  ) {
    const backend = this.createSandboxBackend(profile.openid);
    const model = this.createAgentModel(hasImage);
    const context: LearningAgentToolContext = {
      profile,
      history,
    };
    return createDeepAgent({
      name: 'whale-learning-agent',
      model,
      tools: this.toolsService.buildTools(context) as any,
      systemPrompt: this.buildSystemPrompt(profile, userOrinted),
      backend,
      permissions: LEARNING_AGENT_FILESYSTEM_PERMISSIONS,
    });
  }

  private createSandboxBackend(openid: string) {
    const workspace = this.workspacePath(openid);
    mkdirSync(workspace, { recursive: true });
    return new FilesystemBackend({
      rootDir: workspace,
      virtualMode: true,
      maxFileSizeMb: 5,
    });
  }

  private createAgentModel(hasImage: boolean) {
    return hasImage
      ? this.qwenService.createAgentChatModel({ enableThinking: false })
      : this.deepSeekService.createAgentChatModel();
  }

  private buildMessages(input: LearningAgentChatInput) {
    const messages = [];
    if (input.imageBase64) {
      messages.push(
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: input.message,
            },
            {
              type: 'image_url',
              image_url: {
                url: input.imageBase64,
              },
            },
          ],
        } as any)
      );
    } else {
      messages.push(new HumanMessage(input.message));
    }
    return messages;
  }

  private workspacePath(openid: string) {
    const key = createHash('sha256').update(openid).digest('hex').slice(0, 32);
    return join(this.appDir, 'output', 'learning-agent', key);
  }

  private messageContent(message: any): string {
    const content = message?.content;
    if (typeof content === 'string') {
      return content;
    }
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .map(block => {
        if (typeof block === 'string') {
          return block;
        }
        if (block?.type === 'text' || block?.type === 'output_text') {
          return block.text || '';
        }
        return '';
      })
      .join('');
  }

  private toolCallsOf(message: any) {
    return [
      ...(Array.isArray(message?.tool_calls) ? message.tool_calls : []),
      ...(Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : []),
    ];
  }

  private finalMessageContent(output: any) {
    const messages = output?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return '';
    }
    return this.messageContent(messages[messages.length - 1]);
  }

  private splitMarkdown(content: string) {
    const chunks: string[] = [];
    for (let index = 0; index < content.length; index += 400) {
      chunks.push(content.slice(index, index + 400));
    }
    return chunks;
  }

  private safeJson(value: unknown) {
    if (value === undefined || value === null) {
      return '';
    }
    try {
      const text =
        typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const safe = text
        .replace(
          /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
          '[base64 image omitted]'
        )
        .replace(
          /(["']?imageBase64["']?\s*:\s*)"[^"]*"/gi,
          '$1"[base64 image omitted]"'
        );
      return safe.length > 1200 ? `${safe.slice(0, 1200)}…` : safe;
    } catch {
      return String(value).slice(0, 1200);
    }
  }
}

export function validateLearningAgentInput(
  body: Partial<LearningAgentChatInput> | undefined
): LearningAgentChatInput {
  const bodyImages = (body as any)?.images;
  if (bodyImages !== undefined) {
    if (!Array.isArray(bodyImages)) {
      throw new BusinessError(
        'images must be an array',
        400,
        'INVALID_AGENT_IMAGE'
      );
    }
    if (bodyImages.length > 1) {
      throw new BusinessError(
        '最多上传一张图片',
        400,
        'AGENT_IMAGE_LIMIT_EXCEEDED'
      );
    }
  }
  const message = String(body?.message || '').trim();
  if (!message) {
    throw new BusinessError('message is required', 400, 'MESSAGE_REQUIRED');
  }
  if (message.length > 8000) {
    throw new BusinessError('message is too long', 400, 'MESSAGE_TOO_LONG');
  }
  const history = Array.isArray(body?.history)
    ? body.history
        .filter(
          item =>
            (item?.role === 'user' || item?.role === 'assistant') &&
            typeof item?.content === 'string' &&
            item.content.trim()
        )
        .slice(-MAX_HISTORY_MESSAGES)
        .map(item => ({
          role: item.role,
          content: item.content.slice(0, 8000),
        }))
    : [];
  const rawImageBase64 = body?.imageBase64;
  const imageSource =
    rawImageBase64 !== undefined &&
    (typeof rawImageBase64 !== 'string' || rawImageBase64.trim())
      ? rawImageBase64
      : bodyImages?.[0];
  return {
    message,
    imageBase64: normalizeAgentImageBase64(imageSource),
    history,
  };
}

export function normalizeAgentImageBase64(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BusinessError('图片格式无效', 400, 'INVALID_AGENT_IMAGE');
  }

  const raw = value.trim();
  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(raw);
  const mime = dataUrl?.[1] || 'image/jpeg';
  const payload = (dataUrl?.[2] || raw).replace(/\s/g, '');
  if (
    !payload ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) {
    throw new BusinessError('图片 Base64 格式无效', 400, 'INVALID_AGENT_IMAGE');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) {
    throw new BusinessError('图片 Base64 格式无效', 400, 'INVALID_AGENT_IMAGE');
  }
  if (buffer.length > MAX_AGENT_IMAGE_BYTES) {
    throw new BusinessError('图片不能超过 10MB', 400, 'AGENT_IMAGE_TOO_LARGE');
  }
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime) {
    throw new BusinessError(
      '仅支持 JPG、PNG、GIF 或 WebP 图片',
      400,
      'INVALID_AGENT_IMAGE'
    );
  }
  return `data:${detectedMime || mime};base64,${payload}`;
}

function detectImageMime(buffer: Buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString() === 'GIF89a') {
    return 'image/gif';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString() === 'GIF87a') {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}
