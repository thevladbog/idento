"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Upload, Palette, CheckCircle, BarChart } from "lucide-react";

const steps = [
  { key: "import", icon: Upload, color: "from-blue-500 to-cyan-500" },
  { key: "design", icon: Palette, color: "from-purple-500 to-pink-500" },
  { key: "checkin", icon: CheckCircle, color: "from-green-500 to-emerald-500" },
  { key: "sync", icon: BarChart, color: "from-orange-500 to-red-500" },
];

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <section id="how-it-works" className="container py-16 md:py-24">
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

      <div className="relative max-w-5xl mx-auto">
        {/* Connection Line */}
        <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/20 via-primary to-primary/20 -translate-y-1/2" />

        <div className="grid md:grid-cols-4 gap-8 relative">
          {steps.map(({ key, icon: Icon, color }, index) => (
            <motion.div
              key={key}
              className="relative"
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.2 }}
            >
              <div className="flex flex-col items-center text-center">
                {/* Number Badge */}
                <div
                  className={`relative w-20 h-20 rounded-full bg-gradient-to-br ${color} flex items-center justify-center mb-4 shadow-lg z-10`}
                >
                  <Icon className="h-10 w-10 text-white" />
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-background border-2 border-primary flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </div>
                </div>

                {/* Content */}
                <h3 className="font-bold text-xl mb-2">
                  {t(`steps.${key}.title`)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(`steps.${key}.description`)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
