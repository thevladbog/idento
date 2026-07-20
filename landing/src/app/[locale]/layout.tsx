import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "@/styles/globals.css";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  
  const titles = {
    en: "Idento - Event Check-in That Works Offline | Badge Printing System",
    ru: "Idento - Регистрация на мероприятия офлайн | Система печати бейджей",
  };
  
  const descriptions = {
    en: "Professional event check-in and badge printing system with offline-first architecture. Perfect for conferences, corporate events, and exhibitions. No internet required.",
    ru: "Профессиональная система регистрации и печати бейджей с архитектурой офлайн-first. Идеально для конференций, корпоративных мероприятий и выставок. Интернет не требуется.",
  };

  return {
    title: titles[locale as keyof typeof titles] || titles.en,
    description: descriptions[locale as keyof typeof descriptions] || descriptions.en,
    keywords: [
      "event check-in",
      "badge printing",
      "offline event management",
      "conference registration",
      "attendee management",
      "QR code scanning",
      "event software",
    ],
    authors: [{ name: "Idento" }],
    openGraph: {
      type: "website",
      locale: locale,
      url: "https://idento.app",
      title: titles[locale as keyof typeof titles] || titles.en,
      description: descriptions[locale as keyof typeof descriptions] || descriptions.en,
      siteName: "Idento",
    },
    twitter: {
      card: "summary_large_image",
      title: titles[locale as keyof typeof titles] || titles.en,
      description: descriptions[locale as keyof typeof descriptions] || descriptions.en,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/favicon.svg", type: "image/svg+xml" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as "en" | "ru")) {
    notFound();
  }

  // Set locale for this request so getRequestConfig/getMessages use it (proxy may not set header)
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head></head>
      <body className="min-h-screen bg-background font-sans antialiased overflow-x-hidden">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="relative flex min-h-screen w-full max-w-[100vw] flex-col overflow-x-hidden">
              <Header />
              <main className="flex-1 w-full">{children}</main>
              <Footer />
            </div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
