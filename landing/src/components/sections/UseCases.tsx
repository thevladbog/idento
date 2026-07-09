"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Presentation, Building2, Code2, Users2 } from "lucide-react";

const useCases = [
  { key: "conferences", icon: Presentation, gradient: "from-blue-500/10 to-cyan-500/10" },
  { key: "corporate", icon: Building2, gradient: "from-purple-500/10 to-pink-500/10" },
  { key: "tech", icon: Code2, gradient: "from-green-500/10 to-emerald-500/10" },
  { key: "largescale", icon: Users2, gradient: "from-orange-500/10 to-red-500/10" },
];

export function UseCases() {
  const t = useTranslations("UseCases");

  return (
    <section id="use-cases" className="container py-16 md:py-24 bg-muted/50">
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

      <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
        {useCases.map(({ key, icon: Icon, gradient }, index) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <Card className={`h-full bg-gradient-to-br ${gradient} border-2 transition-all duration-200 hover:border-primary/50 hover:shadow-xl`}>
              <CardHeader>
                <div className="mb-4 rounded-lg bg-primary/10 w-14 h-14 flex items-center justify-center">
                  <Icon className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">{t(`items.${key}.title`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  {t(`items.${key}.description`)}
                </p>
                <ul className="space-y-2 text-sm">
                  {[1, 2, 3].map((i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">✓</span>
                      <span>{t(`items.${key}.benefits.${i}`)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
