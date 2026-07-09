/** @type {import('next-sitemap').IConfig} */
export default {
  siteUrl: process.env.SITE_URL || 'https://idento.app',
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  exclude: ['/server-sitemap.xml'],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
  },
  transform: async (config, path) => {
    // Add locale-specific URLs
    if (path === '/') {
      return [
        {
          loc: '/en',
          changefreq: 'daily',
          priority: 1.0,
          lastmod: new Date().toISOString(),
        },
        {
          loc: '/ru',
          changefreq: 'daily',
          priority: 1.0,
          lastmod: new Date().toISOString(),
        },
      ];
    }
    
    return {
      loc: path,
      changefreq: 'daily',
      priority: 0.7,
      lastmod: new Date().toISOString(),
    };
  },
};
