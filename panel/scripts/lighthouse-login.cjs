/* global location, module, process */
module.exports = async (browser) => {
  const email = process.env.IDENTO_ADMIN_EMAIL;
  const password = process.env.IDENTO_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Lighthouse login environment is missing");

  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4174/login", { waitUntil: "networkidle0" });
  await page.type("#login-email", email);
  await page.type("#login-password", password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === "/");
  await page.close();
};
