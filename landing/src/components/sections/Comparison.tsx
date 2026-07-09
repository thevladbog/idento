"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";

const features = [
  "offlineFirst",
  "selfHosted",
  "perAttendee",
  "multiPlatform",
  "openApi",
  "badgeEditor",
  "qrScanning",
  "mobileApp",
];

export function Comparison() {
  const t = useTranslations("Comparison");

  return (
    <section id="comparison" className="container py-16 md:py-24">
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

      <motion.div
        className="max-w-4xl mx-auto overflow-x-auto"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="min-w-[600px]">
          {/* Header */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="font-bold text-lg">{t("table.feature")}</div>
            <div className="text-center font-bold text-lg bg-primary/10 rounded-lg p-3">
              {t("table.idento")}
            </div>
            <div className="text-center font-medium text-muted-foreground">
              {t("table.traditional")}
            </div>
            <div className="text-center font-medium text-muted-foreground">
              {t("table.competitors")}
            </div>
          </div>

          {/* Rows */}
          <div className="space-y-2">
            {features.map((feature, index) => (
              <motion.div
                key={feature}
                className="grid grid-cols-4 gap-4 items-center p-3 rounded-lg transition-colors duration-200 hover:bg-muted/50"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <div className="font-medium">{t(`features.${feature}`)}</div>
                <div className="flex justify-center">
                  <Check className="h-6 w-6 text-primary" />
                </div>
                <div className="flex justify-center">
                  {["offlineFirst", "selfHosted", "openApi"].includes(feature) ? (
                    <X className="h-6 w-6 text-muted-foreground" />
                  ) : (
                    <Check className="h-6 w-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex justify-center">
                  {["offlineFirst", "selfHosted", "perAttendee"].includes(feature) ? (
                    <X className="h-6 w-6 text-muted-foreground" />
                  ) : (
                    <Check className="h-6 w-6 text-muted-foreground/50" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
