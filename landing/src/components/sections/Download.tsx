"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download as DownloadIcon, Smartphone } from "lucide-react";

const platforms = [
  { key: "windows", icon: "🪟" },
  { key: "macos", icon: "🍎" },
  { key: "linux", icon: "🐧" },
  { key: "android", icon: "📱" },
];

export function Download() {
  const t = useTranslations("Download");

  return (
    <section id="download" className="container py-16 md:py-24">
      <motion.div
        className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center mb-12"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="font-bold text-3xl leading-[1.1] sm:text-3xl md:text-5xl">
          {t("title")}
        </h2>
        <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-lg sm:leading-7">
          {t("subtitle")}
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
        {platforms.map(({ key, icon }, index) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <Card className="h-full transition-all duration-200 hover:shadow-lg hover:border-primary/50">
              <CardHeader className="text-center">
                <div className="text-6xl mb-4">{icon}</div>
                <CardTitle className="text-xl">{t(`platforms.${key}.name`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  {t(`platforms.${key}.format`)}
                </p>
                <Button className="w-full" variant="outline">
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  {t("cta")}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  {t(`platforms.${key}.requirements`)}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Additional Info */}
      <motion.div
        className="max-w-3xl mx-auto mt-12 space-y-6"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Smartphone className="h-6 w-6 text-primary mt-1" />
              <div>
                <h3 className="font-semibold mb-2">{t("info.version")}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("info.changelog")}
                </p>
                <Button variant="link" className="p-0 h-auto">
                  {t("info.viewChangelog")} →
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </section>
  );
}
