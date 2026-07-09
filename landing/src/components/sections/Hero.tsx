"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { CheckCircle2, PlayCircle } from "lucide-react";

export function Hero() {
  const t = useTranslations("Hero");

  const badges = [
    { key: "offline", icon: CheckCircle2 },
    { key: "noInternet", icon: CheckCircle2 },
    { key: "enterprise", icon: CheckCircle2 },
  ];

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background via-background to-muted/30">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none" />

      <div className="container relative z-10 flex flex-col items-center gap-8 pt-16 pb-8 text-center md:pt-24 lg:pt-32">
        {/* Animated Heading */}
        <motion.h1
          className="text-4xl font-extrabold tracking-tight lg:text-6xl xl:text-7xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {t("title")}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          className="max-w-[42rem] text-lg leading-normal text-muted-foreground sm:text-xl sm:leading-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {t("subtitle")}
        </motion.p>

        {/* Trust Badges */}
        <motion.div
          className="flex flex-wrap justify-center gap-4 text-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {badges.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary"
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium">{t(`badges.${key}`)}</span>
            </div>
          ))}
        </motion.div>

        {/* CTAs */}
        <motion.div
          className="flex flex-col sm:flex-row gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Button size="lg" asChild className="text-base">
            <Link href="#pricing">{t("cta.primary")}</Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="text-base">
            <a href="#demo" className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5" />
              {t("cta.secondary")}
            </a>
          </Button>
        </motion.div>

        {/* Product Screenshot/Demo */}
        <motion.div
          className="mt-8 w-full max-w-6xl lg:mt-16"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
        >
          <div className="relative overflow-hidden rounded-2xl border-2 border-primary/20 bg-card shadow-2xl">
            <div className="aspect-video w-full bg-gradient-to-br from-primary/5 via-muted/50 to-primary/10 flex items-center justify-center backdrop-blur-sm">
              <div className="text-center space-y-4 p-8">
                <div className="text-6xl">🎪</div>
                <p className="text-lg font-medium">
                  {t("demo.placeholder")}
                </p>
              </div>
            </div>
            {/* Decorative glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 to-primary/5 blur-2xl -z-10" />
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          className="grid grid-cols-3 gap-8 mt-8 w-full max-w-3xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          {["stat1", "stat2", "stat3"].map((stat) => (
            <div key={stat} className="text-center">
              <div className="text-3xl font-bold text-primary">
                {t(`stats.${stat}.value`)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {t(`stats.${stat}.label`)}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
