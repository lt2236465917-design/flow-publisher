export const XHS_SELECTORS = {
  // Login
  qrCode: 'img[class*="qrcode"], canvas[class*="qr"], div[class*="login-qrcode"] img',
  loginSuccess: 'img[class*="avatar"], div[class*="avatar"], a[href*="publish"]',
  avatarImg: 'img[class*="avatar"]',
  userName: 'span[class*="name"], div[class*="nickname"]',

  // Publish
  uploadInput: 'input[type="file"][accept*="video"]',
  uploadArea: 'div[class*="upload"], div[class*="upload-container"], div[class*="drag"]',
  titleInput: 'input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable], #title',
  descInput: 'textarea[class*="content"], div[class*="content"] [contenteditable], div[class*="note-content"] [contenteditable]',
  hashtagInput: 'input[class*="tag"], input[placeholder*="话题"], input[placeholder*="标签"]',
  coverUpload: 'input[type="file"][accept*="image"]',
  coverSelector: 'div[class*="cover"], div[class*="thumbnail"]',
  submitBtn: 'button:has-text("发布"), button:has-text("发布笔记"), button[class*="publish"], button[class*="submit"]',
  progressBar: 'div[class*="progress"], span[class*="progress"], div[class*="upload-progress"]',
  declarationCheck: 'div[class*="declare"], label[class*="check"], div[class*="protocol"]',
  successIndicator: 'div[class*="success"], div[class*="publish-success"]',

  // Platform-specific
  noteTypeSelector: 'div[class*="note-type"], div[class*="tab-item"]',
  locationInput: 'input[placeholder*="地点"], input[placeholder*="位置"], div[class*="location"] input',
  productLinkInput: 'input[placeholder*="商品"], input[placeholder*="关联"]'
}
