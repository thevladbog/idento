"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";

const plans = [
  { key: "free", popular: false },
  { key: "professional", popular: true },
  { key: "enterprise", popular: false },
];

export function Pricing() {
  const t = useTranslations("Pricing");
  const [annual, setAnnual] = useState(true);

  return (
    <section id="pricing" className="container py-16 md:py-24">
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

        {/* Annual/Monthly Toggle */}
        <div className="flex items-center gap-4 mt-8">
          <span className={`text-sm ${!annual ? "font-bold" : "text-muted-foreground"}`}>
            {t("toggle.monthly")}
          </span>
          <button
            onClick={() => setAnnual(!annual)}
            className="relative w-14 h-7 rounded-full bg-primary transition-colors"
            aria-label="Toggle pricing"
          >
            <div
              className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                annual ? "translate-x-7" : ""
              }`}
            />
          </button>
          <span className={`text-sm ${annual ? "font-bold" : "text-muted-foreground"}`}>
            {t("toggle.annual")}
          </span>
          {annual && (
            <span className="text-xs text-primary font-medium px-2 py-1 bg-primary/10 rounded-full">
              {t("toggle.save")}
            </span>
          )}
        </div>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {plans.map(({ key, popular }, index) => (
          <motion.div
            key={key}
            className="relative"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            {popular && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                {t("popular")}
              </div>
            )}
            <Card className={`h-full ${popular ? "border-primary shadow-lg scale-105" : ""}`}>
              <CardHeader>
                <CardTitle className="text-2xl">{t(`plans.${key}.name`)}</CardTitle>
                <CardDescription>{t(`plans.${key}.description`)}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">
                    {t(`plans.${key}.price.${annual ? "annual" : "monthly"}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {key !== "enterprise" && ` / ${t(`plans.${key}.period`)}`}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => {
                    const feature = t(`plans.${key}.features.${i}`, { default: "" });
                    if (!feature) return null;
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={popular ? "default" : "outline"}
                  size="lg"
                  asChild
                >
                  <Link href="#signup">{t(`plans.${key}.cta`)}</Link>
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Additional Info */}
      <motion.p
        className="text-center text-sm text-muted-foreground mt-8"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        {t("footer")}
      </motion.p>
    </section>
  );
}
