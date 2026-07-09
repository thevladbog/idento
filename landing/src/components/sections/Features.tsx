"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload,
  Wand2,
  QrCode,
  Smartphone,
  Printer,
  Users,
  WifiOff,
  RefreshCw,
} from "lucide-react";

const features = [
  { key: "csvImport", icon: Upload },
  { key: "badgeEditor", icon: Wand2 },
  { key: "qrScanning", icon: QrCode },
  { key: "multiPlatform", icon: Smartphone },
  { key: "printerSupport", icon: Printer },
  { key: "staffManagement", icon: Users },
  { key: "offlineFirst", icon: WifiOff },
  { key: "realTimeSync", icon: RefreshCw },
];

export function Features() {
  const t = useTranslations("Features");

  return (
    <section id="features" className="container space-y-12 py-16 md:py-24">
      <motion.div
        className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center"
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

      <div className="mx-auto grid justify-center gap-4 sm:grid-cols-2 lg:grid-cols-4 md:max-w-[64rem] lg:max-w-[90rem]">
        {features.map(({ key, icon: Icon }, index) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <Card className="h-full transition-shadow duration-200 hover:shadow-lg hover:border-primary/30">
              <CardHeader>
                <div className="mb-2 rounded-lg bg-primary/10 w-12 h-12 flex items-center justify-center">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{t(`items.${key}.title`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t(`items.${key}.description`)}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
