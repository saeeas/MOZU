/** Slack会話から抽出した1件のナレッジ候補 */
export interface KnowledgeCandidate {
  /** 元のSlackチャンネル名 */
  channelName: string;
  channelId: string;
  /** 元メッセージのタイムスタンプ（スレッドリンク用） */
  messageTs: string;
  /** 会話の要約 */
  summary: string;
  /** マニュアルに入れるべきカテゴリ */
  category: string;
  /** マニュアル化したテキスト（手順・ルール形式に整形済み） */
  manualText: string;
  /** マニュアルに入れるべき理由 */
  reason: string;
  /** 重要度 (high / medium / low) */
  importance: "high" | "medium" | "low";
  /** 元の会話テキスト（参照用） */
  originalMessages: string;
  /** 抽出日時 */
  extractedAt: Date;
}

/** Slackの会話スレッド */
export interface ConversationThread {
  channelId: string;
  channelName: string;
  threadTs: string;
  messages: SlackMessage[];
}

export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
}
