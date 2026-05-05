export const DOUYIN_SELECTORS = {
  // Login
  qrCode: 'div[class*="qrcode"] img, div[class*="login"] img[src*="qrcode"], canvas[class*="qr"]',
  loginSuccess: 'div[class*="avatar"], img[class*="avatar"], a[href*="creator-micro/home"]',
  avatarImg: 'img[class*="avatar"]',
  userName: 'span[class*="name"], div[class*="nickname"], p[class*="name"]',

  // Publish
  uploadInput: 'input[type="file"][accept*="video"]',
  uploadArea: 'div[class*="upload"], div[class*="drag-over"], div[class*="upload-btn"]',
  titleInput: 'input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]',
  descInput: 'textarea[class*="desc"], div[class*="desc"] [contenteditable], div[class*="content"] [contenteditable]',
  hashtagInput: 'input[class*="tag"], div[class*="tag"] input, input[placeholder*="话题"], input[placeholder*="添加标签"]',
  coverUpload: 'input[type="file"][accept*="image"]',
  coverSelector: 'div[class*="cover"], div[class*="thumbnail"]',
  submitBtn: 'button:has-text("发布"), button[class*="submit"], button[class*="publish"]',
  progressBar: 'div[class*="progress"], span[class*="progress"]',
  declarationCheck: 'div[class*="declare"], div[class*="protocol"], label[class*="check"]',
  successIndicator: 'div[class*="success"], div[class*="publish-success"]'
}
