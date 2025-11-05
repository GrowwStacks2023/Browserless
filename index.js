
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { 
      browserlessApiKey,
      mediumEmail, 
      mediumPassword, 
      title, 
      subtitle, 
      htmlContent 
    } = req.body;
    
    // Validate inputs
    if (!browserlessApiKey || !mediumEmail || !mediumPassword || !title || !htmlContent) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['browserlessApiKey', 'mediumEmail', 'mediumPassword', 'title', 'htmlContent']
      });
    }
    
    console.log('Connecting to Browserless...');
    
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${browserlessApiKey}`
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Login
    console.log('Logging in to Medium...');
    await page.goto('https://medium.com/m/signin', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const txt = await page.evaluate(el => el.textContent, btn);
      if (txt.toLowerCase().includes('email')) {
        await btn.click();
        break;
      }
    }
    
    await page.waitForTimeout(2000);
    await page.type('input[type="email"]', mediumEmail, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    await page.type('input[type="password"]', mediumPassword, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(7000);
    
    // Create story
    console.log('Creating story...');
    await page.goto('https://medium.com/new-story', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(4000);
    
    // Add title
    await page.click('h1[data-default-value="Title"]');
    await page.keyboard.type(title, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Add subtitle
    if (subtitle) {
      await page.keyboard.type(subtitle, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
    
    // Add HTML content
    const client = await page.target().createCDPSession();
    await client.send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      origin: 'https://medium.com'
    });
    
    await page.evaluate((html) => {
      const blob = new Blob([html], { type: "text/html" });
      const data = [new ClipboardItem({ "text/html": blob })];
      return navigator.clipboard.write(data);
    }, htmlContent);
    
    await page.waitForTimeout(1000);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
    await page.waitForTimeout(5000);
    
    // Publish
    console.log('Publishing...');
    await page.click('button[data-action="show-post-share-invite"]');
    await page.waitForTimeout(3000);
    
    const publishButtons = await page.$$('button');
    for (const btn of publishButtons) {
      const txt = await page.evaluate(el => el.textContent, btn);
      if (txt.includes('Publish now')) {
        await btn.click();
        break;
      }
    }
    
    await page.waitForTimeout(7000);
    
    const publishedUrl = page.url();
    await browser.close();
    
    console.log('Published:', publishedUrl);
    
    return res.status(200).json({
      success: true,
      url: publishedUrl,
      title: title,
      message: 'Article published successfully'
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
};