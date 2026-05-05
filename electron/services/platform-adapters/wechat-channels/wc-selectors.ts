export const WC_SELECTORS = {
  // Login
  qrCode: 'img[class*="qrcode"], canvas[class*="qr"], div[class*="login"] img[src*="qrcode"]',
  loginSuccess: 'img[class*="avatar"], div[class*="avatar"], a[href*="post/list"]',
  avatarImg: 'img[class*="avatar"]',
  userName: 'span[class*="name"], div[class*="nickname"]',

  // Publish
  uploadInput: 'input[type="file"][accept*="video"]',
  uploadArea: 'div[class*="upload"], div[class*="drag-area"], div[class*="upload-wrap"]',
  titleInput: 'input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]',
  descInput: 'textarea[class*="desc"], div[class*="desc"] [contenteditable], div[class*="content"] [contenteditable]',
  hashtagInput: 'input[class*="tag"], input[placeholder*="话题"], input[placeholder*="标签"]',
  coverUpload: 'input[type="file"][accept*="image"]',
  coverSelector: 'div[class*="cover"], div[class*="thumb"]',
  submitBtn: 'button:has-text("发表"), button:has-text("发布"), button[class*="submit"], button[class*="publish"]',
  progressBar: 'div[class*="progress"], span[class*="progress"]',
  declarationCheck: 'div[class*="declare"], label[class*="check"]',
  successIndicator: 'div[class*="success"], div[class*="publish-success"]',

  // Platform-specific
  articleLinkInput: 'input[placeholder*="文章"], input[placeholder*="公众号"]',
  extLinkInput: 'input[placeholder*="链接"], input[placeholder*="扩展"]'
}
