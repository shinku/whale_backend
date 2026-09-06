# Prompt MD 生成规则

`src/prompts/*.md` 中的每个 markdown 文件都是一个 AI 活动的 system prompt，
`actId` 等于文件名（不包含 `.md`）。调用方式：

- system prompt = 对应 md 文件内容
- user 入参 = 前端上传的 `config`，由服务端 `JSON.stringify(config)` 后传入

## 返回格式

1. 默认所有 prompt 返回普通字符串，无任何格式约定。
2. 只有当接口/前端确实需要结构化数据时，prompt 内才必须明确写出 JSON 结构。
3. 需要 JSON 时，必须要求模型只输出一段可被 `JSON.parse` 直接解析的原始 JSON：
   - 不要输出 Markdown 代码块（不要用 ```json ``` 包裹）
   - 不要输出题号、标题、说明等多余内容

## JSON prompt 编写要求

1. 必须写明每个字段的含义、取值范围和示例。
2. 必须写明数组长度/题目数量与入参 `count` 一致。
3. 多选题场景必须限制选项数量，并明确只有正确选项的 `isCorrect` 为 `true`。
4. 字段名统一使用英文小写驼峰或下划线，注意不要使用错别字拼写（例如 options 里的文本字段统一叫 `label`，不要拼成 `lable`）。

## 英语单词练习（word_practice）返回结构

返回一个 JSON 数组，数组长度等于题目数量。每题结构如下：

```json
[
  {
    "label": "apple",
    "phonetic": "/ˈæpl/",
    "options": [
      { "value": "A", "label": "苹果", "isCorrect": true },
      { "value": "B", "label": "香蕉", "isCorrect": false },
      { "value": "C", "label": "梨", "isCorrect": false }
    ]
  }
]
```

字段说明：

- `label`：题目对应的单词（英译中时为英文单词，中译英时为中文词语）。
- `phonetic`：题目单词的音标，必须带重音符号，主重音用 `ˈ`、次重音用 `ˌ` 并放在重读音节前（如 `/ˈvɪzɪt/`）；中译英等无英文音标的题目可为空字符串。
- `options`：3 个选项，选项的 `value` 固定为 `A`、`B`、`C`，文本放在 `label`。
- `isCorrect`：每题 3 个选项中只能有 1 个为 `true`，且正确选项的位置应随机。
