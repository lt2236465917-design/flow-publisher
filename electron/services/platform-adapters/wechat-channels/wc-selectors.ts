export const WC_SELECTORS = {
  // Login
  qrCode: [
    'img[class*="qrcode"]',
    'canvas[class*="qr"]',
    'div[class*="login"] img[src*="qrcode"]',
    'img[src*="qrcode"]',
    'div[class*="qr-code"] img',
    'div[class*="scan"] img'
  ].join(', '),
  loginSuccess: [
    'img[class*="avatar"]',
    'div[class*="avatar"]',
    'a[href*="post/list"]',
    'div[class*="user-info"]',
    'div[class*="account-name"]'
  ].join(', '),
  avatarImg: 'img[class*="avatar"], div[class*="avatar"] img, img[src*="avatar"]',
  userName: 'span[class*="name"], div[class*="nickname"], div[class*="account-name"], span[class*="user-name"]',

  // Publish
  uploadInput: [
    'input[type="file"][accept*="video"]',
    'input[type="file"][accept*="mp4"]',
    'input[type="file"][accept*="mov"]',
    'input[type="file"]'
  ].join(', '),
  uploadArea: 'div[class*="upload"], div[class*="drag-area"], div[class*="upload-wrap"], div[class*="drop-zone"]',
  titleInput: [
    'input[class*="title"]',
    'textarea[class*="title"]',
    'div[class*="title"] [contenteditable]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'div[contenteditable][placeholder*="标题"]'
  ].join(', '),
  descInput: [
    'textarea[class*="desc"]',
    'div[class*="desc"] [contenteditable]',
    'div[class*="content"] [contenteditable]',
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="内容"]',
    'div[contenteditable][placeholder*="描述"]'
  ].join(', '),
  hashtagInput: [
    'input[class*="tag"]',
    'input[placeholder*="话题"]',
    'input[placeholder*="标签"]',
    'input[placeholder*="hashtag"]',
    'div[class*="topic"] input'
  ].join(', '),
  coverUpload: 'input[type="file"][accept*="image"]',
  coverSelector: 'div[class*="cover"], div[class*="thumb"], div[class*="poster"]',
  submitBtn: [
    'button:has-text("发表")',
    'button:has-text("发布")',
    'button[class*="submit"]',
    'button[class*="publish"]',
    'button:has-text("确认发布")',
    'button:has-text("立即发布")'
  ].join(', '),
  progressBar: 'div[class*="progress"], span[class*="progress"], div[class*="percent"]',
  declarationCheck: 'div[class*="declare"], label[class*="check"], div[class*="checkbox"]',
  successIndicator: 'div[class*="success"], div[class*="publish-success"], div[class*="toast"]',

  // Platform-specific
  articleLinkInput: 'input[placeholder*="文章"], input[placeholder*="公众号"], input[class*="article"]',
  extLinkInput: 'input[placeholder*="链接"], input[placeholder*="扩展"], input[class*="link"]'
}
