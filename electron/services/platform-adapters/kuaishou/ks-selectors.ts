export const KS_SELECTORS = {
  // Login
  qrCode: 'img[class*="qrcode"], canvas[class*="qr"], div[class*="login"] img[src*="qrcode"]',
  loginSuccess: 'img[class*="avatar"], div[class*="avatar"], a[href*="publish"]',
  avatarImg: 'img[class*="avatar"]',
  userName: 'span[class*="name"], div[class*="nickname"]',

  // Publish
  uploadInput: 'input[type="file"][accept*="video"]',
  uploadArea: 'div[class*="upload"], div[class*="drag-over"], div[class*="upload-area"]',
  titleInput: 'input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]',
  descInput: 'textarea[class*="desc"], div[class*="desc"] [contenteditable], div[class*="content"] [contenteditable]',
  hashtagInput: 'input[class*="tag"], input[placeholder*="话题"], input[placeholder*="标签"], input[placeholder*="挑战"]',
  coverUpload: 'input[type="file"][accept*="image"]',
  coverSelector: 'div[class*="cover"], div[class*="thumbnail"]',
  submitBtn: 'button:has-text("发布"), button[class*="submit"], button[class*="publish"]',
  progressBar: 'div[class*="progress"], span[class*="progress"]',
  declarationCheck: 'div[class*="declare"], label[class*="check"]',
  successIndicator: 'div[class*="success"], div[class*="publish-success"]',

  // Platform-specific
  challengeInput: 'input[placeholder*="挑战"], input[placeholder*="话题"]',
  localToggle: 'div[class*="local"], label:has-text("同城"), input[class*="local"]',
  magicEmojiSelector: 'div[class*="magic"], div[class*="emoji-effect"]'
}
