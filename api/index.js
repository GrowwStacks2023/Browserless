const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Use POST method'
    });
  }
  
  let browser;
  
  try {
    const { 
      browserlessApiKey,
      mediumEmail, 
      mediumPassword, 
      title, 
      subtitle, 
      htmlContent 
    } = req.body;
    
    console.log('Starting Medium posting for:', title);
    
    if (!browserlessApiKey || !mediumEmail || !mediumPassword || !title || !htmlContent) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['browserlessApiKey', 'mediumEmail', 'mediumPassword', 'title', 'htmlContent']
      });
    }
    
    console.log('Connecting to Browserless...');
    
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${browserlessApiKey}`
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Login to Medium
    console.log('Going to Medium login page...');
    await page.goto('https://medium.com/m/signin', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    // Wait longer for page to load
    await page.waitForTimeout(5000);
    
    console.log('Looking for sign-in button...');
    
    // Try to find and click "Sign in with email" button
    try {
      await page.waitForSelector('button', { timeout: 10000 });
      
      const buttons = await page.$$('button');
      let clicked = false;
      
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent.toLowerCase(), btn);
        if (text.includes('email') || text.includes('sign in with email')) {
          await btn.click();
          clicked = true;
          console.log('Clicked email sign-in button');
          break;
        }
      }
      
      if (!clicked) {
        console.log('Email button not found, trying direct input');
      }
      
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('Button click failed, continuing:', e.message);
    }
    
    // Try multiple selectors for email input
    console.log('Looking for email input...');
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[autocomplete="username"]',
      'input[autocomplete="email"]'
    ];
    
    let emailInput = null;
    for (const selector of emailSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        emailInput = selector;
        console.log('Found email input with selector:', selector);
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!emailInput) {
      // Take screenshot for debugging
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.status(500).json({
        success: false,
        error: 'Could not find email input field',
        screenshot: screenshot.substring(0, 100) + '...',
        pageUrl: page.url()
      });
    }
    
    // Type email
    console.log('Typing email...');
    await page.type(emailInput, mediumEmail, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    
    // Find password input
    console.log('Looking for password input...');
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete="current-password"]'
    ];
    
    let passwordInput = null;
    for (const selector of passwordSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        passwordInput = selector;
        console.log('Found password input');
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!passwordInput) {
      await browser.close();
      return res.status(500).json({
        success: false,
        error: 'Could not find password input field'
      });
    }
    
    // Type password
    console.log('Typing password...');
    await page.type(passwordInput, mediumPassword, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(8000);
    
    // Check if still on login page
    const currentUrl = page.url();
    if (currentUrl.includes('signin') || currentUrl.includes('login')) {
      await browser.close();
      return res.status(500).json({
        success: false,
        error: 'Login failed - still on login page. Check credentials.'
      });
    }
    
    console.log('Logged in successfully');
    
    // Create new story
    console.log('Creating new story...');
    await page.goto('https://medium.com/new-story', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    await page.waitForTimeout(5000);
    
    // Add title
    console.log('Adding title...');
    const titleSelectors = [
      'h1[data-default-value="Title"]',
      '[data-testid="storyTitle"]',
      'h1[contenteditable="true"]',
      'h1.graf--title'
    ];
    
    let titleAdded = false;
    for (const selector of titleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        await page.keyboard.type(title, { delay: 50 });
        titleAdded = true;
        console.log('Title added');
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!titleAdded) {
      await browser.close();
      return res.status(500).json({
        success: false,
        error: 'Could not add title'
      });
    }
    
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    
    // Add subtitle if provided
    if (subtitle) {
      console.log('Adding subtitle...');
      await page.keyboard.type(subtitle, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
    
    // Add HTML content using clipboard
    console.log('Adding content...');
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
    await page.waitForTimeout(6000);
    
    console.log('Content added');
    
    // Publish
    console.log('Publishing...');
    const publishSelectors = [
      'button[data-action="show-post-share-invite"]',
      'button[aria-label="Publish"]'
    ];
    
    let publishClicked = false;
    for (const selector of publishSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        publishClicked = true;
        console.log('Clicked publish button');
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!publishClicked) {
      // Try finding by text
      const allButtons = await page.$$('button');
      for (const btn of allButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Publish')) {
          await btn.click();
          publishClicked = true;
          break;
        }
      }
    }
    
    await page.waitForTimeout(4000);
    
    // Click "Publish now"
    console.log('Confirming publish...');
    const modalButtons = await page.$$('button');
    for (const btn of modalButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Publish now')) {
        await btn.click();
        console.log('Clicked Publish now');
        break;
      }
    }
    
    await page.waitForTimeout(8000);
    
    const publishedUrl = page.url();
    await browser.close();
    
    console.log('Success! Published at:', publishedUrl);
    
    return res.status(200).json({
      success: true,
      url: publishedUrl,
      title: title,
      message: 'Article published successfully'
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    if (browser) {
      await browser.close();
    }
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};