const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('http://localhost:5173/timeline', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  // Nav tabs
  const navLinks = await page.$$eval('nav a', els =>
    els.map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') }))
  );
  console.log('NAV:', JSON.stringify(navLinks));

  // H1
  const h1 = await page.$eval('h1', el => el.textContent.trim()).catch(() => 'no h1');
  console.log('H1:', h1);

  // Filter buttons
  const filters = await page.$$eval('button', els =>
    els.map(b => b.textContent.trim()).filter(t => t.length > 0 && t.length < 40)
  );
  console.log('FILTERS:', JSON.stringify(filters));

  // Event card titles (h3)
  const cards = await page.$$eval('h3', els => els.map(h => h.textContent.trim()));
  console.log('CARD COUNT:', cards.length);
  console.log('FIRST 6 CARDS:', JSON.stringify(cards.slice(0, 6)));

  // Cards on left side and right side (alternating layout check)
  const leftCards = await page.$$eval('.invisible ~ div h3, div:has(.invisible) h3', els =>
    els.map(h => h.textContent.trim())
  ).catch(() => []);
  console.log('Visible cards check:', leftCards.length);

  // Screenshot
  await page.screenshot({ path: 'C:\\Users\\David\\AppData\\Local\\Temp\\claude\\timeline-screenshot.png', fullPage: false });
  console.log('Screenshot saved');

  // Test filter: click "Lore" button
  const loreBtn = await page.getByRole('button', { name: /lore/i }).first();
  if (loreBtn) {
    await loreBtn.click();
    await page.waitForTimeout(300);
    const afterFilter = await page.$$eval('h3', els => els.map(h => h.textContent.trim()));
    console.log('AFTER LORE FILTER - cards:', afterFilter.length, JSON.stringify(afterFilter.slice(0, 4)));
  }

  // Click "All" to reset
  const allBtn = await page.getByRole('button', { name: /^(todo|all)$/i }).first();
  if (allBtn) {
    await allBtn.click();
    await page.waitForTimeout(300);
    const afterAll = await page.$$eval('h3', els => els.map(h => h.textContent.trim()));
    console.log('AFTER ALL FILTER - cards:', afterAll.length);
  }

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
