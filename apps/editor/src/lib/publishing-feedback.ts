export const PUBLISHING_DELAY_MESSAGE = '已保存，用户端内容更新可能延迟，请稍后核对'

export function publishingDelayMessage(warning?: string) {
  return warning ? `${warning}；${PUBLISHING_DELAY_MESSAGE}` : PUBLISHING_DELAY_MESSAGE
}
