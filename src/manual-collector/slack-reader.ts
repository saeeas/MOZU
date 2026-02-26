import { WebClient } from "@slack/web-api";
import { ConversationThread, SlackMessage } from "./types";

/**
 * Slackの各チャンネルから会話を収集する
 */
export class SlackReader {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  /**
   * 指定期間の全チャンネルの会話を取得
   * @param since 何時間前からの会話を取得するか（デフォルト24時間）
   */
  async collectRecentConversations(
    since: number = 24
  ): Promise<ConversationThread[]> {
    const oldest = String(
      Math.floor((Date.now() - since * 60 * 60 * 1000) / 1000)
    );

    // Botが参加しているチャンネル一覧を取得
    const channels = await this.getJoinedChannels();
    const threads: ConversationThread[] = [];

    for (const ch of channels) {
      const channelThreads = await this.getChannelThreads(
        ch.id,
        ch.name,
        oldest
      );
      threads.push(...channelThreads);
    }

    return threads;
  }

  /**
   * Bot が参加しているチャンネル一覧
   */
  private async getJoinedChannels(): Promise<
    { id: string; name: string }[]
  > {
    const result = await this.client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
    });

    return (result.channels || [])
      .filter((ch: any) => ch.is_member)
      .map((ch: any) => ({ id: ch.id, name: ch.name || ch.id }));
  }

  /**
   * チャンネル内のスレッド（3メッセージ以上）を取得
   * 短い雑談は除外し、実質的な会話のみ対象にする
   */
  private async getChannelThreads(
    channelId: string,
    channelName: string,
    oldest: string
  ): Promise<ConversationThread[]> {
    const threads: ConversationThread[] = [];

    // チャンネルのメッセージ一覧
    const history = await this.client.conversations.history({
      channel: channelId,
      oldest,
      limit: 100,
    });

    for (const msg of history.messages || []) {
      // スレッドがあるメッセージ（reply_count >= 2）のみ対象
      if (!msg.reply_count || msg.reply_count < 2) continue;

      const replies = await this.client.conversations.replies({
        channel: channelId,
        ts: msg.ts!,
        limit: 50,
      });

      const messages: SlackMessage[] = (replies.messages || []).map(
        (m: any) => ({
          user: m.user || "bot",
          text: m.text || "",
          ts: m.ts || "",
        })
      );

      threads.push({
        channelId,
        channelName,
        threadTs: msg.ts!,
        messages,
      });
    }

    return threads;
  }
}
